// src/services/partnerService.ts

import { Partner } from '@prisma/client'
import { inject } from 'inversify'
import { sha512_224 } from 'js-sha512'
import jwt from 'jsonwebtoken'

import { IAuthService, IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

export class PartnerService implements IPartnerService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IAuthService) private authService: IAuthService,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  public async getPartnerFromApiKey(apiKey: string) {
    // Hash the API key using SHA-512/224
    if (!apiKey) {
      throw new Error('API key not provided')
    }

    // Hash the API key using SHA-512/224
    const apiKeyHash = sha512_224(apiKey)

    // Obtain a database client from the injected provider
    const prismaClient = await this.databaseClientProvider.getClient()

    // Find the partner using the hashed API key
    const partner = await prismaClient.partner.findFirst({
      where: { apiKey: apiKeyHash },
    })

    if (!partner) {
      throw new Error('Partner not found')
    }

    return partner
  }

  // Retrieves the partner based on the API key found in the request header.
  public async getPartnerFromBearerToken(token: string): Promise<Partner> {
    try {
      const decodedToken = await this.authService.verifyToken(token)
      const userId = decodedToken.userId

      const prismaClient = await this.databaseClientProvider.getClient()

      const partner = await prismaClient.partner.findFirst({
        where: { id: userId },
      })

      if (!partner) {
        throw new Error('Partner not found')
      }

      return partner
    }
    catch (error) {
      console.error('Error verifying token:', error)
      throw new Error('Firebase token verification failed')
    }
  }

  public async getPartnerFromSepJwt(token: string): Promise<Partner> {
    try {
      const sepJwtSecret = await this.secretManager.getSecret('STELLAR_SEP_JWT_SECRET')
      const sepPartnerId = await this.secretManager.getSecret('STELLAR_SEP_PARTNER_ID')

      // Verify and decode the JWT token
      jwt.verify(token, sepJwtSecret)

      const prismaClient = await this.databaseClientProvider.getClient()

      const partner = await prismaClient.partner.findFirst({
        where: { id: sepPartnerId },
      })

      if (!partner) {
        throw new Error('Partner not found')
      }

      return partner
    }
    catch (error) {
      console.error('Error verifying SEP JWT:', error)
      throw new Error('SEP JWT verification failed')
    }
  }
}
