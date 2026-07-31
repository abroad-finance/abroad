import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import { OutboxStatus, TransactionStatus } from '@prisma/client'

import { PartnerTransactionNotFoundError, PartnerTransactionQueryService, PartnerTransactionQueryValidationError } from '../../../../modules/transactions/application/PartnerTransactionQueryService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type PrismaMock = {
  outboxEvent: { findMany: jest.Mock }
  transaction: {
    count: jest.Mock
    findFirst: jest.Mock
    findMany: jest.Mock
    groupBy: jest.Mock
  }
}

const quote = {
  country: 'BR',
  cryptoCurrency: 'USDC',
  network: 'POLYGON',
  paymentMethod: 'PIX',
  sourceAmount: 20,
  targetAmount: 105.75,
  targetCurrency: 'BRL',
}

const transaction = {
  accountNumber: 'customer@example.com',
  bankCode: 'internal-bank',
  createdAt: new Date('2026-07-30T10:00:00.000Z'),
  externalId: 'provider-reference',
  id: '11111111-1111-4111-8111-111111111111',
  onChainId: '0xabc',
  partnerUser: { userId: '=dangerous-reference' },
  pixEndToEndId: 'E1234567890123456789012345678901',
  quote,
  refundOnChainId: null,
  status: TransactionStatus.PAYMENT_COMPLETED,
  taxId: 'sensitive-tax-id',
  transitions: [
    {
      context: null,
      createdAt: new Date('2026-07-30T10:02:00.000Z'),
      event: 'status_changed',
      fromStatus: TransactionStatus.AWAITING_PAYMENT,
      id: 'transition-1',
      toStatus: TransactionStatus.PROCESSING_PAYMENT,
    },
    {
      context: null,
      createdAt: new Date('2026-07-30T10:05:00.000Z'),
      event: 'status_changed',
      fromStatus: TransactionStatus.PROCESSING_PAYMENT,
      id: 'transition-2',
      toStatus: TransactionStatus.PAYMENT_COMPLETED,
    },
  ],
}

const makePrisma = (): PrismaMock => ({
  outboxEvent: { findMany: jest.fn(async () => []) },
  transaction: {
    count: jest.fn(async () => 0),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    groupBy: jest.fn(async () => []),
  },
})

const makeService = (prisma: PrismaMock): PartnerTransactionQueryService => {
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return new PartnerTransactionQueryService(databaseClientProvider)
}

describe('PartnerTransactionQueryService.search', () => {
  it('enforces tenant ownership, filters deterministically, and returns status counts', async () => {
    const prisma = makePrisma()
    prisma.transaction.findMany.mockResolvedValue([transaction])
    prisma.transaction.count.mockResolvedValue(1)
    prisma.transaction.groupBy.mockResolvedValue([
      { _count: { _all: 1 }, status: TransactionStatus.PAYMENT_COMPLETED },
    ])

    const result = await makeService(prisma).search('partner-1', {
      createdFrom: '2026-07-01',
      createdTo: '2026-07-31',
      page: 2,
      pageSize: 10,
      query: 'customer-42',
      status: TransactionStatus.PAYMENT_COMPLETED,
    })

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
      where: {
        AND: [
          expect.objectContaining({
            createdAt: {
              gte: new Date('2026-07-01T00:00:00.000Z'),
              lt: new Date('2026-08-01T00:00:00.000Z'),
            },
            partnerUser: { partnerId: 'partner-1' },
          }),
          { status: TransactionStatus.PAYMENT_COMPLETED },
        ],
      },
    }))
    const baseWhere = prisma.transaction.findMany.mock.calls[0][0].where.AND[0]
    expect(baseWhere.OR).toEqual(expect.arrayContaining([
      { partnerUser: { userId: { contains: 'customer-42', mode: 'insensitive' } } },
    ]))
    expect(result.items[0]).toEqual({
      createdAt: transaction.createdAt,
      id: transaction.id,
      onChainId: transaction.onChainId,
      quote,
      status: TransactionStatus.PAYMENT_COMPLETED,
      userReference: '=dangerous-reference',
    })
    expect(result.statusCounts).toEqual(expect.arrayContaining([
      { count: 1, status: TransactionStatus.PAYMENT_COMPLETED },
      { count: 0, status: TransactionStatus.PAYMENT_FAILED },
    ]))
  })

  it.each([
    [{ page: 0 }, 'Page must be a positive integer'],
    [{ pageSize: 101 }, 'Page size must be between 1 and 100'],
    [{ createdFrom: '2026-02-30' }, 'Date is not a valid calendar day'],
    [{ createdFrom: '07/01/2026' }, 'Dates must use YYYY-MM-DD format'],
    [{ createdFrom: '2026-08-01', createdTo: '2026-07-01' }, 'Start date must be on or before end date'],
  ])('rejects invalid filters %#', async (filters, message) => {
    const service = makeService(makePrisma())

    await expect(service.search('partner-1', filters)).rejects.toThrow(message)
  })
})

describe('PartnerTransactionQueryService.getById', () => {
  it('returns a redacted detail, lifecycle, masked destination, and derived deliveries', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValue(transaction)
    prisma.outboxEvent.findMany.mockResolvedValue([
      {
        attempts: 0,
        payload: {
          kind: 'webhook',
          payload: { data: { id: transaction.id }, event: 'transaction.updated' },
          target: 'https://must-not-leak.example',
        },
        status: OutboxStatus.DELIVERED,
        updatedAt: new Date('2026-07-30T10:06:00.000Z'),
      },
    ])

    const result = await makeService(prisma).getById('partner-1', transaction.id)

    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: transaction.id, partnerUser: { partnerId: 'partner-1' } },
    }))
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        attempts: true,
        payload: true,
        status: true,
        updatedAt: true,
      },
      where: {
        payload: { equals: transaction.id, path: ['payload', 'data', 'id'] },
        type: 'webhook',
      },
    }))
    expect(result.lifecycle).toEqual([
      {
        occurredAt: transaction.createdAt,
        status: TransactionStatus.AWAITING_PAYMENT,
        type: 'CREATED',
      },
      {
        occurredAt: new Date('2026-07-30T10:02:00.000Z'),
        status: TransactionStatus.PROCESSING_PAYMENT,
        type: 'STATUS_CHANGED',
      },
      {
        occurredAt: new Date('2026-07-30T10:05:00.000Z'),
        status: TransactionStatus.PAYMENT_COMPLETED,
        type: 'STATUS_CHANGED',
      },
    ])
    expect(result.payoutDestinationHint).toBe('•••• .com')
    expect(result.pixEndToEndId).toBe(transaction.pixEndToEndId)
    expect(result.refund).toBeNull()
    expect(result.deliveries).toEqual([{
      attempts: 1,
      event: 'transaction.updated',
      lastAttemptAt: new Date('2026-07-30T10:06:00.000Z'),
      status: OutboxStatus.DELIVERED,
    }])
    expect(result).not.toHaveProperty('accountNumber')
    expect(result).not.toHaveProperty('bankCode')
    expect(result).not.toHaveProperty('externalId')
    expect(result).not.toHaveProperty('taxId')
  })

  it.each([
    {
      contextStatus: undefined,
      expectedStatus: 'NOT_STARTED',
      refundOnChainId: null,
    },
    {
      contextStatus: 'pending',
      expectedStatus: 'PROCESSING',
      refundOnChainId: null,
    },
    {
      contextStatus: 'failed',
      expectedStatus: 'FAILED',
      refundOnChainId: null,
    },
    {
      contextStatus: 'succeeded',
      expectedStatus: 'COMPLETED',
      refundOnChainId: null,
    },
    {
      contextStatus: 'failed',
      expectedStatus: 'COMPLETED',
      refundOnChainId: '0xrefund',
    },
  ] as const)('derives refund status from durable evidence: $expectedStatus', async ({
    contextStatus,
    expectedStatus,
    refundOnChainId,
  }) => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValue({
      ...transaction,
      refundOnChainId,
      status: TransactionStatus.PAYMENT_FAILED,
      transitions: contextStatus
        ? [
            ...transaction.transitions,
            {
              context: { status: contextStatus },
              createdAt: new Date('2026-07-30T10:07:00.000Z'),
              event: 'refund',
              fromStatus: TransactionStatus.PAYMENT_FAILED,
              id: 'refund-transition',
              toStatus: TransactionStatus.PAYMENT_FAILED,
            },
          ]
        : transaction.transitions,
    })

    const result = await makeService(prisma).getById('partner-1', transaction.id)

    expect(result.refund).toEqual({
      onChainId: refundOnChainId,
      status: expectedStatus,
    })
  })

  it('does not expose a stored PIX identifier for a non-PIX transaction', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValue({
      ...transaction,
      quote: { ...transaction.quote, paymentMethod: 'BREB' },
    })

    const result = await makeService(prisma).getById('partner-1', transaction.id)

    expect(result.pixEndToEndId).toBeNull()
  })

  it('uses the same not-found response for missing and cross-tenant transactions', async () => {
    const prisma = makePrisma()

    await expect(makeService(prisma).getById('other-partner', transaction.id))
      .rejects.toBeInstanceOf(PartnerTransactionNotFoundError)
    expect(prisma.outboxEvent.findMany).not.toHaveBeenCalled()
  })
})

describe('PartnerTransactionQueryService.exportCsv', () => {
  it('applies partner filters, neutralizes formulas, and excludes internal data', async () => {
    const prisma = makePrisma()
    prisma.transaction.findMany.mockResolvedValue([transaction])

    const result = await makeService(prisma).exportCsv('partner-1', {
      status: TransactionStatus.PAYMENT_COMPLETED,
    })

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 5_001,
      where: {
        partnerUser: { partnerId: 'partner-1' },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    }))
    expect(result.csv).toContain('"\'=dangerous-reference"')
    expect(result.csv).toContain(`"${transaction.id}"`)
    expect(result.csv).not.toContain('provider-reference')
    expect(result.csv).not.toContain('sensitive-tax-id')
    expect(result.csv).not.toContain('internal-bank')
    expect(result.rowCount).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('reports when the 5,000-row export cap is reached', async () => {
    const prisma = makePrisma()
    prisma.transaction.findMany.mockResolvedValue(Array.from({ length: 5_001 }, () => transaction))

    const result = await makeService(prisma).exportCsv('partner-1', {})

    expect(result.rowCount).toBe(5_000)
    expect(result.truncated).toBe(true)
  })
})

describe('PartnerTransactionQueryValidationError', () => {
  it('preserves a stable public error type', () => {
    expect(new PartnerTransactionQueryValidationError('invalid').name)
      .toBe('PartnerTransactionQueryValidationError')
  })
})
