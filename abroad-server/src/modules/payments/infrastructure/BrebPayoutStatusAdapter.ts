import { TransactionStatus } from '@prisma/client'
import { injectable } from 'inversify'

import { IPayoutStatusAdapter } from '../application/contracts/IPayoutStatusAdapter'

/**
 * Maps Breb (PIX alias) payout statuses into internal transaction statuses.
 * Breb surfaces ISO-like codes such as ACCP/ACSC (accepted), RJCT (rejected), CANC (cancelled),
 * with pending states reported as PDNG or textual "pending/processing".
 */
@injectable()
export class BrebPayoutStatusAdapter implements IPayoutStatusAdapter {
  public readonly name = 'breb'

  public mapStatus(rawStatus: string): TransactionStatus {
    const normalized = rawStatus.trim().toUpperCase()

    if (this.isFailure(normalized)) {
      return TransactionStatus.PAYMENT_FAILED
    }
    if (this.isSuccess(normalized)) {
      return TransactionStatus.PAYMENT_COMPLETED
    }
    return TransactionStatus.PROCESSING_PAYMENT
  }

  private isFailure(status: string): boolean {
    return ['RJ', 'RJCT', 'CANC', 'CANCELED', 'CANCELLED', 'FAIL', 'FAILED', 'ERROR', 'REJECTED']
      .some(code => status.includes(code))
  }

  private isSuccess(status: string): boolean {
    return ['ACCP', 'ACSC', 'SUCCESS', 'COMPLETED', 'PROCESSED']
      .some(code => status.includes(code))
  }
}
