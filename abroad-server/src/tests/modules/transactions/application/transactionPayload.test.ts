import { TransactionOrigin } from '@prisma/client'

import { toWebhookTransactionPayload } from '../../../../modules/transactions/application/transactionPayload'

describe('toWebhookTransactionPayload', () => {
  it('omits internal bank and routing fields from partner-facing payloads', () => {
    const payload = toWebhookTransactionPayload({
      bankCode: 'internal-bank-code',
      id: 'transaction-1',
      origin: TransactionOrigin.SEP_24,
      status: 'PAYMENT_COMPLETED',
    })

    expect(payload).toEqual({
      id: 'transaction-1',
      status: 'PAYMENT_COMPLETED',
    })
    expect(payload).not.toHaveProperty('bankCode')
    expect(payload).not.toHaveProperty('origin')
  })
})
