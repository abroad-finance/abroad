import { TransactionStatus } from '@prisma/client'
import { injectable } from 'inversify'

import { IPayoutStatusAdapter } from '../application/contracts/IPayoutStatusAdapter'

@injectable()
export class TransferoPayoutStatusAdapter implements IPayoutStatusAdapter {
  public readonly name = 'transfero'

  public mapStatus(rawStatus: string): TransactionStatus {
    const normalized = rawStatus.toLowerCase()
    if (['canceled', 'cancelled', 'error', 'failed', 'rejected'].some(word => normalized.includes(word))) {
      return TransactionStatus.PAYMENT_FAILED
    }
    if (['processed', 'settled', 'success', 'completed'].some(word => normalized.includes(word))) {
      return TransactionStatus.PAYMENT_COMPLETED
    }
    if (['pending', 'processing', 'queued'].some(word => normalized.includes(word))) {
      return TransactionStatus.PROCESSING_PAYMENT
    }
    return TransactionStatus.PROCESSING_PAYMENT
  }
}
