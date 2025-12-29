import { TransactionStatus } from '@prisma/client'

import { TransactionStatusMapper } from '../../../../modules/transactions/application/TransactionStatusMapper'

describe('TransactionStatusMapper', () => {
  const mapper = new TransactionStatusMapper()

  it('maps provider statuses to completed', () => {
    expect(mapper.mapProviderStatus('transfero', 'processed')).toBe(TransactionStatus.PAYMENT_COMPLETED)
    expect(mapper.mapProviderStatus('transfero', 'SUCCESS')).toBe(TransactionStatus.PAYMENT_COMPLETED)
  })

  it('maps provider statuses to failed', () => {
    expect(mapper.mapProviderStatus('transfero', 'cancelled')).toBe(TransactionStatus.PAYMENT_FAILED)
    expect(mapper.mapProviderStatus('transfero', 'Error happened')).toBe(TransactionStatus.PAYMENT_FAILED)
  })

  it('maps provider statuses to processing when ambiguous', () => {
    expect(mapper.mapProviderStatus('transfero', 'pending')).toBe(TransactionStatus.PROCESSING_PAYMENT)
    expect(mapper.mapProviderStatus('unknown', 'queued')).toBe(TransactionStatus.PROCESSING_PAYMENT)
  })
})
