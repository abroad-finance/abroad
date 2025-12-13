// src/modules/partners/application/partnerService.ts

import type { Partner, PrismaClient } from '@prisma/client'

import { inject, injectable } from 'inversify'
import { sha512_224 } from 'js-sha512'
import jwt from 'jsonwebtoken'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'
import { IPartnerService } from './contracts/IPartnerService'

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

    const hashedApiKey = this.hashApiKey(normalizedApiKey)

    const partner = await this.findPartnerByApiKey(prismaClient, hashedApiKey)

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

  private extractClientDomain(payload: SepTokenPayload): string | undefined {
    const rootDomain = this.normalizeClientDomain(payload.client_domain)
    if (rootDomain) {
      return rootDomain
    }

    const nestedDomain = this.normalizeClientDomain(payload.data?.client_domain)
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
    clientDomain: string,
  ): Promise<null | Partner> {
    const normalizedClientDomain = this.normalizeClientDomain(clientDomain)

    if (!normalizedClientDomain) {
      return null
    }

    const clientDomainHash = this.hashClientDomain(normalizedClientDomain)
    return prismaClient.partner.findFirst({
      where: { clientDomainHash },
    })
  }

  private hashApiKey(apiKey: string): string {
    return sha512_224(apiKey)
  }

  private hashClientDomain(clientDomain: string): string {
    return sha512_224(clientDomain)
  }

  private isJwtPayload(payload: unknown): payload is SepTokenPayload {
    return typeof payload === 'object' && payload !== null
  }

  private normalizeClientDomain(clientDomain?: string): string | undefined {
    if (typeof clientDomain !== 'string') {
      return undefined
    }

    const normalizedDomain = clientDomain.trim().toLowerCase()

    return normalizedDomain.length > 0 ? normalizedDomain : undefined
  }
}
