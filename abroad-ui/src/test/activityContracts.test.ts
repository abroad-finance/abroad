import { describe, expect, it } from 'vitest'

import type { ConsumerActivityTransactionDto } from '../api'

import {
  parseConsumerActivityList,
  parseConsumerActivityReceipt,
} from '../features/activity/model/activityContracts'

const transaction = {
  id: '11111111-1111-4111-8111-111111111111',
  proof: { receiptAvailable: false, status: 'PENDING' },
  quote: {
    country: 'BR',
    network: 'STELLAR',
    paymentMethod: 'PIX',
    sourceAmount: 10,
    sourceCurrency: 'USDC',
    targetAmount: 52.54,
    targetCurrency: 'BRL',
  },
  recipientHint: '•••• 1234',
  refund: { reference: null, status: 'NOT_APPLICABLE' },
  status: 'PROCESSING_PAYMENT',
  timestamps: {
    acceptedAt: '2026-08-01T10:00:00.000Z',
    completedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    lastReconciledAt: null,
    payoutSubmittedAt: null,
    updatedAt: '2026-08-01T10:02:00.000Z',
  },
} satisfies ConsumerActivityTransactionDto

describe('consumer Activity runtime contracts', () => {
  it('accepts bounded list and receipt payloads', () => {
    expect(parseConsumerActivityList({
      items: [transaction],
      page: 1,
      pageSize: 20,
      total: 1,
    }).items).toEqual([transaction])

    expect(parseConsumerActivityReceipt({
      ...transaction,
      effectiveRate: '5.254',
      fee: { amount: '1.25', currency: 'USDC', type: 'COMBINED' },
      lifecycle: [{
        occurredAt: transaction.timestamps.createdAt,
        status: 'AWAITING_PAYMENT',
        type: 'CREATED',
      }],
      references: {
        abroadId: transaction.id,
        brebId: null,
        onChainId: 'on-chain-reference',
        pixEndToEndId: null,
        providerId: null,
        refundOnChainId: null,
      },
    }).id).toBe(transaction.id)
  })

  it('rejects unknown lifecycle states and inconsistent rail corridors', () => {
    expect(() => parseConsumerActivityList({
      items: [{ ...transaction, status: 'PROVIDER_COMPLETE' }],
      page: 1,
      pageSize: 20,
      total: 1,
    })).toThrow()
    expect(() => parseConsumerActivityList({
      items: [{
        ...transaction,
        quote: { ...transaction.quote, country: 'CO' },
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })).toThrow()
  })

  it('rejects oversized pages and high-cardinality references', () => {
    expect(() => parseConsumerActivityList({
      items: Array.from({ length: 51 }, () => transaction),
      page: 1,
      pageSize: 50,
      total: 51,
    })).toThrow()
    expect(() => parseConsumerActivityReceipt({
      ...transaction,
      effectiveRate: null,
      fee: null,
      lifecycle: [],
      references: {
        abroadId: transaction.id,
        brebId: null,
        onChainId: 'x'.repeat(257),
        pixEndToEndId: null,
        providerId: null,
        refundOnChainId: null,
      },
    })).toThrow()
  })
})
