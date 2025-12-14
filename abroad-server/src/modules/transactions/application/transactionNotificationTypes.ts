import { Prisma } from '@prisma/client'

export const transactionNotificationInclude = {
  partnerUser: { include: { partner: true } },
  quote: true,
} as const

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof transactionNotificationInclude
}>
