import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  CustomerFeeType,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import { ConsumerActivityNotFoundError, ConsumerActivityService, ConsumerActivityValidationError } from '../../../../modules/transactions/application/ConsumerActivityService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type PrismaMock = {
  transaction: {
    count: jest.Mock
    findFirst: jest.Mock
    findMany: jest.Mock
  }
}

const quote = {
  baseRateSourcePerTarget: new Prisma.Decimal('0.19'),
  country: Country.BR,
  cryptoCurrency: CryptoCurrency.USDC,
  customerFeeSourceAmount: new Prisma.Decimal('1.25'),
  customerFeeSourceCurrency: CryptoCurrency.USDC,
  customerFeeType: CustomerFeeType.COMBINED,
  exchangeFeePct: new Prisma.Decimal('0.01'),
  fixedFeeTargetAmount: new Prisma.Decimal('1'),
  network: BlockchainNetwork.STELLAR,
  paymentMethod: PaymentMethod.PIX,
  sourceAmount: 100,
  targetAmount: 525.4,
  targetCurrency: TargetCurrency.BRL,
}

const transaction = {
  accountNumber: 'customer@example.com',
  bankCode: 'must-not-leak',
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  economics: {
    lastReconciledAt: new Date('2026-08-01T10:07:00.000Z'),
    lockedRateNativePerUsd: new Prisma.Decimal('5.254'),
  },
  exchangeHandoffAt: new Date('2026-08-01T10:03:00.000Z'),
  externalId: 'provider-reference-1',
  id: '11111111-1111-4111-8111-111111111111',
  onChainId: 'stellar-transaction-1',
  partnerUser: { userId: 'stellar:pubnet:GABC' },
  pixEndToEndId: 'E1234567890123456789012345678901',
  qrCode: 'must-not-leak',
  quote,
  refundOnChainId: null,
  status: TransactionStatus.PAYMENT_COMPLETED,
  taxId: 'must-not-leak',
  transitions: [
    {
      context: null,
      createdAt: new Date('2026-08-01T10:02:00.000Z'),
      event: 'deposit_received',
      fromStatus: TransactionStatus.AWAITING_PAYMENT,
      id: 'transition-1',
      toStatus: TransactionStatus.PROCESSING_PAYMENT,
    },
    {
      context: null,
      createdAt: new Date('2026-08-01T10:06:00.000Z'),
      event: 'payout_completed',
      fromStatus: TransactionStatus.PROCESSING_PAYMENT,
      id: 'transition-2',
      toStatus: TransactionStatus.PAYMENT_COMPLETED,
    },
  ],
}

const makePrisma = (): PrismaMock => ({
  transaction: {
    count: jest.fn(async () => 0),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
  },
})

const makeService = (prisma: PrismaMock): ConsumerActivityService => {
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return new ConsumerActivityService(databaseClientProvider)
}

describe('ConsumerActivityService.list', () => {
  it('derives ownership from the verified subject and filters before stable pagination', async () => {
    const prisma = makePrisma()
    prisma.transaction.findMany.mockResolvedValue([transaction])
    prisma.transaction.count.mockResolvedValue(1)

    const result = await makeService(prisma).list('partner-1', 'stellar:pubnet:GABC', {
      createdFrom: '2026-08-01',
      createdTo: '2026-08-02',
      network: BlockchainNetwork.STELLAR,
      page: 2,
      pageSize: 10,
      paymentMethod: PaymentMethod.PIX,
      sort: 'newest',
      status: TransactionStatus.PAYMENT_COMPLETED,
      targetCurrency: TargetCurrency.BRL,
    })

    const expectedWhere = {
      createdAt: {
        gte: new Date('2026-08-01T00:00:00.000Z'),
        lt: new Date('2026-08-03T00:00:00.000Z'),
      },
      partnerUser: { partnerId: 'partner-1', userId: 'stellar:pubnet:GABC' },
      quote: {
        network: BlockchainNetwork.STELLAR,
        paymentMethod: PaymentMethod.PIX,
        targetCurrency: TargetCurrency.BRL,
      },
      status: TransactionStatus.PAYMENT_COMPLETED,
    }
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
      where: expectedWhere,
    }))
    expect(prisma.transaction.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(result).toEqual({
      items: [expect.objectContaining({
        id: transaction.id,
        recipientHint: '•••• .com',
        status: TransactionStatus.PAYMENT_COMPLETED,
      })],
      page: 2,
      pageSize: 10,
      total: 1,
    })
    expect(result.items[0]).not.toHaveProperty('accountNumber')
    expect(result.items[0]).not.toHaveProperty('bankCode')
    expect(result.items[0]).not.toHaveProperty('externalId')
    expect(result.items[0]).not.toHaveProperty('qrCode')
    expect(result.items[0]).not.toHaveProperty('taxId')
  })

  it('uses a stable ascending order when oldest is requested', async () => {
    const prisma = makePrisma()

    await makeService(prisma).list('partner-1', 'stellar:pubnet:GABC', {
      sort: 'oldest',
    })

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }))
  })

  it.each([
    [{ page: 0 }, 'Page must be a positive integer'],
    [{ pageSize: 51 }, 'Page size must be between 1 and 50'],
    [{ createdFrom: '08/01/2026' }, 'Dates must use YYYY-MM-DD format'],
    [{ createdFrom: '2026-02-30' }, 'Date is not a valid calendar day'],
    [{ createdFrom: '2026-08-03', createdTo: '2026-08-01' }, 'Start date must be on or before end date'],
    [{ sort: 'sideways' as never }, 'Sort must be newest or oldest'],
  ])('rejects invalid filters %#', async (filters, message) => {
    await expect(makeService(makePrisma()).list(
      'partner-1',
      'stellar:pubnet:GABC',
      filters,
    )).rejects.toEqual(new ConsumerActivityValidationError(message))
  })
})

describe('ConsumerActivityService.getById', () => {
  it('returns an authoritative receipt snapshot without fabricating unavailable values', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValue(transaction)

    const result = await makeService(prisma).getById(
      'partner-1',
      'stellar:pubnet:GABC',
      transaction.id,
    )

    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: transaction.id,
        partnerUser: { partnerId: 'partner-1', userId: 'stellar:pubnet:GABC' },
      },
    }))
    expect(result).toEqual(expect.objectContaining({
      effectiveRate: '5.254',
      fee: {
        amount: '1.25',
        currency: CryptoCurrency.USDC,
        type: 'COMBINED',
      },
      id: transaction.id,
      proof: {
        receiptAvailable: true,
        status: 'AVAILABLE',
      },
      recipientHint: '•••• .com',
      references: {
        abroadId: transaction.id,
        brebId: null,
        onChainId: transaction.onChainId,
        pixEndToEndId: transaction.pixEndToEndId,
        providerId: transaction.externalId,
        refundOnChainId: null,
      },
      timestamps: {
        acceptedAt: transaction.createdAt,
        completedAt: new Date('2026-08-01T10:06:00.000Z'),
        createdAt: transaction.createdAt,
        lastReconciledAt: new Date('2026-08-01T10:07:00.000Z'),
        payoutSubmittedAt: transaction.exchangeHandoffAt,
        updatedAt: new Date('2026-08-01T10:06:00.000Z'),
      },
    }))
    expect(result.lifecycle).toHaveLength(3)
    expect(result).not.toHaveProperty('accountNumber')
    expect(result).not.toHaveProperty('taxId')
  })

  it('keeps historical fee truth unavailable when the quote predates fee snapshots', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValue({
      ...transaction,
      quote: {
        ...transaction.quote,
        customerFeeSourceAmount: null,
        customerFeeSourceCurrency: null,
        customerFeeType: null,
      },
    })

    const result = await makeService(prisma).getById(
      'partner-1',
      'stellar:pubnet:GABC',
      transaction.id,
    )

    expect(result.fee).toBeNull()
  })

  it('does not claim a completed refund without the canonical refund transaction identity', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValue({
      ...transaction,
      status: TransactionStatus.PAYMENT_FAILED,
      transitions: [
        ...transaction.transitions,
        {
          context: { status: 'succeeded' },
          createdAt: new Date('2026-08-01T10:08:00.000Z'),
          event: 'refund',
          fromStatus: TransactionStatus.PAYMENT_FAILED,
          id: 'transition-refund',
          toStatus: TransactionStatus.PAYMENT_FAILED,
        },
      ],
    })

    const result = await makeService(prisma).getById(
      'partner-1',
      'stellar:pubnet:GABC',
      transaction.id,
    )

    expect(result.refund).toEqual({ reference: null, status: 'UNKNOWN' })
  })

  it('uses one not-found response for missing, cross-wallet, and cross-partner records', async () => {
    const prisma = makePrisma()

    await expect(makeService(prisma).getById(
      'partner-2',
      'stellar:pubnet:OTHER',
      transaction.id,
    )).rejects.toBeInstanceOf(ConsumerActivityNotFoundError)
  })

  it('rejects malformed detail identifiers before querying', async () => {
    const prisma = makePrisma()

    await expect(makeService(prisma).getById(
      'partner-1',
      'stellar:pubnet:GABC',
      '../transaction',
    )).rejects.toEqual(new ConsumerActivityValidationError('Transaction ID must be a UUID'))
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled()
  })
})
