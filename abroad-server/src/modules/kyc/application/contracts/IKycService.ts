import type { Prisma, PrismaClient } from '@prisma/client'

export interface IKycService {
  /**
   * True when the user already has an APPROVED KYC record. Used by transaction
   * acceptance to gate above-threshold transactions.
   *
   * An optional client can be passed so the check runs inside an existing
   * Prisma `$transaction`.
   */
  hasApprovedKyc(partnerUserId: string, client?: KycPrismaClient): Promise<boolean>
}

export type KycPrismaClient = Prisma.TransactionClient | PrismaClient
