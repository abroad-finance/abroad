import { TransactionStatus } from '@prisma/client'

export class TransactionStatusMapper {
  public mapProviderStatus(provider: string, rawStatus: string): TransactionStatus {
    const normalizedProvider = provider.toLowerCase()
    switch (normalizedProvider) {
      case 'transfero':
        return this.mapDefault(rawStatus)
      default:
        return this.mapDefault(rawStatus)
    }
  }

  private mapDefault(rawStatus: string): TransactionStatus {
    const normalized = rawStatus.toLowerCase()
    if ([
      'canceled',
      'cancelled',
      'error',
      'failed',
      'rejected',
    ].some(word => normalized.includes(word))) {
      return TransactionStatus.PAYMENT_FAILED
    }

    if ([
      'processed',
      'settled',
      'success',
      'completed',
    ].some(word => normalized.includes(word))) {
      return TransactionStatus.PAYMENT_COMPLETED
    }

    if ([
      'pending',
      'processing',
      'queued',
    ].some(word => normalized.includes(word))) {
      return TransactionStatus.PROCESSING_PAYMENT
    }

    return TransactionStatus.PROCESSING_PAYMENT
  }
}
