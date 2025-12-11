// src/infrastructure/db.ts
import { PrismaClient } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

@injectable()
export class PrismaClientProvider implements IDatabaseClientProvider {
  private datasourceUrl: null | string = null
  private prismaClient: null | PrismaClient = null

  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) {}

  public async getClient(): Promise<PrismaClient> {
    // Return the cached client if available.
    if (this.prismaClient) {
      return this.prismaClient
    }

    // Cache the datasourceUrl to avoid multiple calls.
    if (!this.datasourceUrl) {
      this.datasourceUrl = await this.secretManager.getSecret('DATABASE_URL')
    }

    // Instantiate and cache the PrismaClient.
    this.prismaClient = new PrismaClient({
      datasourceUrl: this.datasourceUrl,
    })

    return this.prismaClient
  }
}
