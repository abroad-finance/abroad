// src/modules/partners/application/partnerService.ts

import type { Partner, PrismaClient } from '@prisma/client'

import { inject, injectable } from 'inversify'
import jwt from 'jsonwebtoken'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'
import { type ClientDomain, hashClientDomain, parseClientDomain as parseClientDomainValue } from '../domain/clientDomain'
import { IPartnerService } from './contracts/IPartnerService'
import { hashPartnerApiKey } from './partnerApiKey'

interface SepTokenPayload extends jwt.JwtPayload {
  client_domain?: string
  data?: {
    amount?: string
    asset?: string
    client_domain?: string
    client_name?: string
    lang?: string
  }
  exp: number
  iat: number
  iss: string
  sub: string
}

@injectable()
export class PartnerService implements IPartnerService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

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

  public async getPartnerFromSepJwt(token: string): Promise<Partner> {
    try {
      const [sepJwtSecret, sepPartnerId] = await Promise.all([
        this.secretManager.getSecret('STELLAR_SEP_JWT_SECRET'),
        this.secretManager.getSecret('STELLAR_SEP_PARTNER_ID'),
      ])

      const decodedToken = jwt.verify(token, sepJwtSecret)

      if (!this.isJwtPayload(decodedToken)) {
        throw new Error('Invalid SEP JWT payload')
      }

      const prismaClient = await this.databaseClientProvider.getClient()

      const clientDomain = this.extractClientDomain(decodedToken)

      if (clientDomain) {
        const partner = await this.findPartnerByClientDomain(prismaClient, clientDomain)
        if (partner) {
          return partner
        }
      }

      const partner = await prismaClient.partner.findFirst({ where: { id: sepPartnerId } })

      if (!partner) {
        throw new Error('Partner not found')
      }

      return partner
    }
    catch {
      throw new Error('SEP JWT verification failed')
    }
  }

  private extractClientDomain(payload: SepTokenPayload): ClientDomain | undefined {
    const rootDomain = this.parseClientDomain(payload.client_domain)
    if (rootDomain) {
      return rootDomain
    }

    const nestedDomain = this.parseClientDomain(payload.data?.client_domain)
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

  private isJwtPayload(payload: unknown): payload is SepTokenPayload {
    return typeof payload === 'object' && payload !== null
  }

  private parseClientDomain(clientDomain?: string): ClientDomain | undefined {
    if (typeof clientDomain !== 'string') {
      return undefined
    }

    return parseClientDomainValue(clientDomain) ?? undefined
  }
}
