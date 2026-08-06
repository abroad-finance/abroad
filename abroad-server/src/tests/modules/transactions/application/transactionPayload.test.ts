import { TransactionOrigin } from '@prisma/client'

import { toUserTransactionPayload, toWebhookTransactionPayload } from '../../../../modules/transactions/application/transactionPayload'

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

describe('toUserTransactionPayload', () => {
  const transactionWithPartner = {
    accountNumber: '1234567890',
    bankCode: 'internal-bank-code',
    id: 'transaction-1',
    onChainId: '0xhash',
    partnerUser: {
      partner: {
        apiKey: 'sk_live_super_secret',
        email: 'partner@example.com',
        id: 'partner-1',
        phone: '+5511999999999',
        previousApiKey: 'sk_live_rotated',
      },
      userId: 'celo:0xabc',
    },
    status: 'PAYMENT_COMPLETED',
    taxId: '123.456.789-00',
    updatedAt: new Date('2026-08-06T00:00:00.000Z'),
  }

  it('never lets partner credentials reach a customer socket', () => {
    const payload = toUserTransactionPayload(transactionWithPartner)

    // This channel is a browser. The webhook payload carries the partner's
    // relation graph; serialising it here published their API key.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('sk_live_super_secret')
    expect(serialized).not.toContain('sk_live_rotated')
    expect(serialized).not.toContain('partner@example.com')
    expect(payload).not.toHaveProperty('partnerUser')
  })

  it('keeps only what the customer needs to follow their own transaction', () => {
    expect(toUserTransactionPayload(transactionWithPartner)).toEqual({
      cryptoCurrency: undefined,
      id: 'transaction-1',
      onChainId: '0xhash',
      quote: null,
      status: 'PAYMENT_COMPLETED',
      updatedAt: '2026-08-06T00:00:00.000Z',
    })
  })

  it('does not forward the customer\'s own bank details back over the wire', () => {
    const payload = toUserTransactionPayload(transactionWithPartner)

    expect(payload).not.toHaveProperty('accountNumber')
    expect(payload).not.toHaveProperty('taxId')
    expect(payload).not.toHaveProperty('bankCode')
  })
})
