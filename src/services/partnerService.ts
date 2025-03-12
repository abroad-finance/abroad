import { Request } from 'express'
import { inject } from 'inversify'
import { sha512_224 } from 'js-sha512'

import { IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { TYPES } from '../types'

export class PartnerService implements IPartnerService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private databaseClientProvider: IDatabaseClientProvider,
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
    const partner = await prismaClient.partner.findUnique({
      where: { apiKey: apiKeyHash },
    })

    if (!partner) {
      throw new Error('Partner not found')
    }

    return partner
  }

  // Retrieves the partner based on the API key found in the request header.
  public async getPartnerFromRequest(request: Request) {
    const apiKey = request.header('X-API-Key')
    if (!apiKey) {
      throw new Error('API key not provided')
    }
    return this.getPartnerFromApiKey(apiKey)
  }
}
