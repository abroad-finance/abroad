import 'reflect-metadata'
import { OutboxStatus, TransactionStatus } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsTransactionNotFoundError, OpsTransactionQueryService } from '../../../../modules/transactions/application/OpsTransactionQueryService'

type PrismaMock = {
  flowInstance: { findMany: jest.Mock, findUnique: jest.Mock }
  flowSignal: { findMany: jest.Mock }
  outboxEvent: { findMany: jest.Mock }
  transaction: { count: jest.Mock, findMany: jest.Mock, findUnique: jest.Mock, groupBy: jest.Mock }
}

const makePrisma = (): PrismaMock => ({
  flowInstance: {
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
  },
  flowSignal: { findMany: jest.fn(async () => []) },
  outboxEvent: { findMany: jest.fn(async () => []) },
  transaction: {
    count: jest.fn(async () => 0),
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
    groupBy: jest.fn(async () => []),
  },
})

const makeService = (prisma: PrismaMock): OpsTransactionQueryService => {
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  return new OpsTransactionQueryService(dbProvider)
}

const quote = {
  country: 'CO',
  createdAt: new Date('2026-06-10T09:55:00Z'),
  cryptoCurrency: 'USDC',
  network: 'CELO',
  paymentMethod: 'PIX',
  sourceAmount: 25,
  targetAmount: 50,
  targetCurrency: 'BRL',
}

const txRow = {
  accountNumber: '+5521999991234',
  bankCode: '001',
  createdAt: new Date('2026-06-10T10:00:00Z'),
  exchangeHandoffAt: new Date('2026-06-10T10:02:00Z'),
  externalId: 'provider-1',
  id: 'tx-1',
  onChainId: '0xabc',
  opsCase: null,
  partnerUser: { partner: { id: 'p1', name: 'Partner One' }, userId: 'private-user-reference' },
  pixEndToEndId: 'E123',
  qrCode: 'private-qr',
  quote,
  quoteId: 'quote-1',
  refundOnChainId: null,
  status: TransactionStatus.PAYMENT_COMPLETED,
  taxId: 'private-tax-id',
  transitions: [
    {
      context: null,
      createdAt: new Date('2026-06-10T10:03:00Z'),
      event: 'payment_completed',
      fromStatus: TransactionStatus.PROCESSING_PAYMENT,
      id: 'transition-1',
      toStatus: TransactionStatus.PAYMENT_COMPLETED,
    },
  ],
}

describe('OpsTransactionQueryService.search', () => {
  it('applies explicit identifier/date/corridor filters and returns minimized operational summaries', async () => {
    const prisma = makePrisma()
    prisma.transaction.findMany.mockResolvedValue([txRow])
    prisma.transaction.count.mockResolvedValue(1)
    prisma.transaction.groupBy.mockResolvedValue([{ _count: { _all: 1 }, status: TransactionStatus.PAYMENT_COMPLETED }])

    const result = await makeService(prisma).search({
      createdFrom: '2026-06-01',
      createdTo: '2026-06-30',
      page: 1,
      pageSize: 20,
      partnerId: 'p1',
      paymentMethod: 'PIX',
      query: '0xabc',
      status: TransactionStatus.PAYMENT_COMPLETED,
    }, new Date('2026-06-10T10:05:00Z'))

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    }))
    const where = prisma.transaction.findMany.mock.calls[0]?.[0]?.where
    expect(JSON.stringify(where)).toContain('0xabc')
    expect(JSON.stringify(where)).toContain('2026-06-01')
    expect(JSON.stringify(where)).toContain('PAYMENT_COMPLETED')
    expect(result.statusCounts).toContainEqual({ count: 1, status: TransactionStatus.PAYMENT_COMPLETED })
    expect(result.items[0]).toEqual(expect.objectContaining({
      partner: { id: 'p1', name: 'Partner One' },
      proof: { receiptEligible: true, status: 'AVAILABLE' },
      status: TransactionStatus.PAYMENT_COMPLETED,
    }))
    expect(result.items[0]).not.toHaveProperty('accountNumber')
    expect(result.items[0]).not.toHaveProperty('taxId')
    expect(result.items[0]).not.toHaveProperty('userId')
  })

  it('builds an exception-first missing-proof queue without fetching on type', async () => {
    const prisma = makePrisma()

    await makeService(prisma).search({ attention: 'PROOF_MISSING' })

    const where = prisma.transaction.findMany.mock.calls[0]?.[0]?.where
    expect(where).toEqual(expect.objectContaining({ AND: expect.any(Array) }))
    expect(JSON.stringify(where)).toContain('pixEndToEndId')
    expect(JSON.stringify(where)).toContain('PAYMENT_COMPLETED')
  })

  it('exports a bounded PII-minimized applied view and reports truncation', async () => {
    const prisma = makePrisma()
    prisma.transaction.findMany.mockResolvedValue([txRow])
    prisma.transaction.count.mockResolvedValue(120)

    const result = await makeService(prisma).getFilteredEvidenceExport({
      partnerId: 'p1',
      query: 'chain-reference',
    })

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    expect(result.filterDimensions).toEqual(['partnerId', 'query'])
    expect(result.truncated).toBe(true)
    expect(result.items[0]).not.toHaveProperty('accountNumber')
    expect(JSON.stringify(result)).not.toContain('private-tax-id')
    expect(JSON.stringify(result)).not.toContain('private-user-reference')
  })
})

describe('OpsTransactionQueryService.getById', () => {
  it('composes a safe chronological investigation detail and masks the payout destination', async () => {
    const prisma = makePrisma()
    prisma.transaction.findUnique.mockResolvedValue(txRow)
    prisma.outboxEvent.findMany.mockResolvedValue([
      {
        attempts: 1,
        availableAt: new Date('2026-06-10T10:03:00Z'),
        createdAt: new Date('2026-06-10T10:03:00Z'),
        id: 'delivery-1',
        lastAttemptDurationMs: 120,
        lastError: null,
        lastHttpStatus: 200,
        payload: {},
        status: OutboxStatus.DELIVERED,
        transactionId: 'tx-1',
        updatedAt: new Date('2026-06-10T10:04:00Z'),
        webhookEvent: 'transaction.updated',
        webhookPurpose: 'TRANSACTION',
      },
    ])

    const detail = await makeService(prisma).getById('tx-1', new Date('2026-06-10T10:05:00Z'))

    expect(detail.identifiers).toEqual(expect.objectContaining({
      flowInstanceId: null,
      pixEndToEndId: 'E123',
      quoteId: 'quote-1',
      transactionId: 'tx-1',
    }))
    expect(detail.payoutDestinationHint).toBe('•••• 1234')
    expect(detail.evidence.map(event => event.category)).toEqual(expect.arrayContaining([
      'QUOTE', 'TRANSACTION', 'CHAIN', 'PROVIDER', 'WEBHOOK', 'PROOF',
    ]))
    expect(detail.evidence.every((event, index, events) => (
      index === 0 || events[index - 1].occurredAt <= event.occurredAt
    ))).toBe(true)
    expect(detail).not.toHaveProperty('accountNumber')
    expect(detail).not.toHaveProperty('taxId')
    expect(detail).not.toHaveProperty('qrCode')
  })

  it('normalizes raw provider failure evidence without returning the raw error', async () => {
    const prisma = makePrisma()
    prisma.transaction.findUnique.mockResolvedValue({
      ...txRow,
      status: TransactionStatus.PAYMENT_FAILED,
      transitions: [{
        context: { reason: 'provider_timeout private-detail' },
        createdAt: new Date('2026-06-10T10:03:00Z'),
        event: 'payment_failed',
        fromStatus: TransactionStatus.PROCESSING_PAYMENT,
        id: 'transition-failed',
        toStatus: TransactionStatus.PAYMENT_FAILED,
      }],
    })

    const detail = await makeService(prisma).getById('tx-1')

    expect(detail.failure).toEqual(expect.objectContaining({ category: 'PROVIDER_UNAVAILABLE' }))
    expect(JSON.stringify(detail)).not.toContain('private-detail')
  })

  it('throws when the transaction does not exist', async () => {
    const prisma = makePrisma()

    await expect(makeService(prisma).getById('missing')).rejects.toBeInstanceOf(OpsTransactionNotFoundError)
  })
})
