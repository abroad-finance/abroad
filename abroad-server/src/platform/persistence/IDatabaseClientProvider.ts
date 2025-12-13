// src/platform/persistence/IDatabaseClientProvider.ts
import { PrismaClient } from '@prisma/client'

export interface IDatabaseClientProvider {
  getClient(): Promise<PrismaClient>
}
