// src/services/partnerService.ts

import type { Partner, PrismaClient } from '@prisma/client'

import { inject } from 'inversify'
import { sha512_224 } from 'js-sha512'
import jwt from 'jsonwebtoken'

import { IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

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

export class PartnerService implements IPartnerService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  public async getPartnerFromApiKey(apiKey?: string) {
    if (!apiKey) {
      throw new Error('API key not provided')
    }

    const prismaClient = await this.databaseClientProvider.getClient()

    const partner = await this.findPartnerByApiKey(prismaClient, apiKey)

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
        const partner = await this.findPartnerByApiKey(prismaClient, clientDomain)
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
    if (typeof payload.client_domain === 'string' && payload.client_domain.trim().length > 0) {
      return payload.client_domain
    }

    if (
      payload.data
      && typeof payload.data === 'object'
      && payload.data !== null
      && typeof payload.data.client_domain === 'string'
      && payload.data.client_domain.trim().length > 0
    ) {
      return payload.data.client_domain
    }

    return undefined
  }

  private async findPartnerByApiKey(
    prismaClient: PrismaClient,
    apiKey: string,
  ): Promise<null | Partner> {
    const apiKeyHash = this.hashApiKey(apiKey)
    return prismaClient.partner.findFirst({
      where: { apiKey: apiKeyHash },
    })
  }

  private hashApiKey(apiKey: string): string {
    return sha512_224(apiKey)
  }

  private isJwtPayload(payload: unknown): payload is SepTokenPayload {
    return typeof payload === 'object' && payload !== null
  }
}
