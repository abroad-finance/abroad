import { TransactionStatus } from '@prisma/client'

export interface IPayoutStatusAdapter {
  mapStatus(rawStatus: string): TransactionStatus
}
