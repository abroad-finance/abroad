// src/modules/partners/application/partnerService.ts

import type { Partner, PrismaClient } from '@prisma/client'

import { inject, injectable } from 'inversify'
import jwt from 'jsonwebtoken'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'
import { type ClientDomain, hashClientDomain, parseClientDomain as parseClientDomainValue } from '../domain/clientDomain'
import { BearerAuthentication, IPartnerService } from './contracts/IPartnerService'
import { hashPartnerApiKey } from './partnerApiKey'

interface VerifiedBearerPayload extends jwt.JwtPayload {
  client_domain?: string
  data?: Record<string, unknown>
  sub: string
}

@injectable()
export class PartnerService implements IPartnerService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  public async authenticateBearerToken(token: string): Promise<BearerAuthentication> {
    try {
      const [sepJwtSecret, sepPartnerId] = await Promise.all([
        this.secretManager.getSecret('STELLAR_SEP_JWT_SECRET'),
        this.secretManager.getSecret('STELLAR_SEP_PARTNER_ID'),
      ])

      const decodedToken = jwt.verify(token, sepJwtSecret)

      if (!this.isBearerPayload(decodedToken)) {
        throw new Error('Invalid Bearer JWT payload')
      }

      const prismaClient = await this.databaseClientProvider.getClient()
      const source = this.resolveBearerSource(decodedToken)

      const clientDomain = this.extractClientDomain(decodedToken)

      if (clientDomain) {
        const partner = await this.findPartnerByClientDomain(prismaClient, clientDomain)
        if (partner) {
          return { partner, source }
        }
      }

      const partner = await prismaClient.partner.findFirst({ where: { id: sepPartnerId } })

      if (!partner) {
        throw new Error('Partner not found')
      }

      return { partner, source }
    }
    catch {
      throw new Error('Bearer JWT verification failed')
    }
  }

  public async getPartnerFromApiKey(apiKey?: string) {
    const normalizedApiKey = apiKey?.trim()

    if (!normalizedApiKey) {
      throw new Error('API key not provided')
    }

    const prismaClient = await this.databaseClientProvider.getClient()

    const hashedApiKey = hashPartnerApiKey(normalizedApiKey)

    const partner = await this.findPartnerByApiKey(prismaClient, hashedApiKey)

    if (!partner) {
      throw new Error('Partner not found')
    }

    return partner
  }

  public async getPartnerFromClientDomain(clientDomain: ClientDomain): Promise<Partner> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const partner = await this.findPartnerByClientDomain(prismaClient, clientDomain)
    if (!partner) {
      throw new Error('Partner not found')
    }
    return partner
  }

  private extractClientDomain(payload: VerifiedBearerPayload): ClientDomain | undefined {
    const rootDomain = this.parseClientDomain(payload.client_domain)
    if (rootDomain) {
      return rootDomain
    }

    const nestedClientDomain = payload.data?.client_domain
    const nestedDomain = this.parseClientDomain(
      typeof nestedClientDomain === 'string' ? nestedClientDomain : undefined,
    )
    if (nestedDomain) {
      return nestedDomain
    }

    return undefined
  }

  private async findPartnerByApiKey(
    prismaClient: PrismaClient,
    hashedApiKey: string,
  ): Promise<null | Partner> {
    return prismaClient.partner.findFirst({
      where: { apiKey: hashedApiKey },
    })
  }

  private async findPartnerByClientDomain(
    prismaClient: PrismaClient,
    clientDomain: ClientDomain,
  ): Promise<null | Partner> {
    const clientDomainHash = this.hashClientDomain(clientDomain)
    return prismaClient.partner.findFirst({
      where: { clientDomainHash },
    })
  }

  private hashClientDomain(clientDomain: ClientDomain): string {
    return hashClientDomain(clientDomain)
  }

  private isBearerPayload(payload: unknown): payload is VerifiedBearerPayload {
    return (
      typeof payload === 'object'
      && payload !== null
      && 'sub' in payload
      && typeof payload.sub === 'string'
      && payload.sub.trim().length > 0
      && (
        !('data' in payload)
        || payload.data === undefined
        || (
          typeof payload.data === 'object'
          && payload.data !== null
          && !Array.isArray(payload.data)
        )
      )
    )
  }

  private parseClientDomain(clientDomain?: string): ClientDomain | undefined {
    if (typeof clientDomain !== 'string') {
      return undefined
    }

    return parseClientDomainValue(clientDomain) ?? undefined
  }

  private resolveBearerSource(
    payload: VerifiedBearerPayload,
  ): BearerAuthentication['source'] {
    if (
      typeof payload.iss !== 'string'
      || payload.iss.trim().length === 0
      || typeof payload.jti !== 'string'
      || payload.jti.trim().length === 0
    ) {
      return 'WALLET'
    }

    try {
      const issuer = new URL(payload.iss)
      const normalizedPath = issuer.pathname.replace(/\/+$/, '')
      return (
        (issuer.protocol === 'https:' || issuer.protocol === 'http:')
        && normalizedPath.endsWith('/auth')
      )
        ? 'SEP_24'
        : 'WALLET'
    }
    catch {
      return 'WALLET'
    }
  }
}
