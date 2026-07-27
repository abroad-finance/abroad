import { TransactionStatus } from '@prisma/client'
import { injectable } from 'inversify'

import { IPayoutStatusAdapter } from '../application/contracts/IPayoutStatusAdapter'

@injectable()
export class TransferoPayoutStatusAdapter implements IPayoutStatusAdapter {
  public readonly name = 'transfero'

  public mapStatus(rawStatus: string): TransactionStatus {
    switch (rawStatus.trim().toUpperCase()) {
      case 'CANCELLED':
      case 'FAILED':
      case 'REJECTED':
      case 'RETURNED':
        return TransactionStatus.PAYMENT_FAILED
      case 'SETTLED':
        return TransactionStatus.PAYMENT_COMPLETED
      case 'APPROVED':
      case 'PENDING':
      case 'PENDING_APPROVAL':
      case 'PROCESSING':
      default:
        return TransactionStatus.PROCESSING_PAYMENT
    }
  }
}
