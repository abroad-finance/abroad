import 'reflect-metadata'
import { PaymentMethod, TargetCurrency, TransactionStatus } from '@prisma/client'

import { TransactionAcceptanceService, TransactionValidationError } from '../../../../modules/transactions/application/TransactionAcceptanceService'
import { createMockLogger } from '../../../setup/mockFactories'

const buildPaymentService = () => ({
  currency: TargetCurrency.COP,
  fixedFee: 0,
  getLiquidity: jest.fn(async () => 0),
  isAsync: false,
  isEnabled: true,
  MAX_TOTAL_AMOUNT_PER_DAY: 100,
  MAX_USER_AMOUNT_PER_DAY: 100,
  MAX_USER_AMOUNT_PER_TRANSACTION: 100,
  MAX_USER_TRANSACTIONS_PER_DAY: 1,
  MIN_USER_AMOUNT_PER_TRANSACTION: 0,
  onboardUser: jest.fn(),
  percentageFee: 0,
  sendPayment: jest.fn(),
  verifyAccount: jest.fn(),
})

describe('TransactionAcceptanceService helpers', () => {
  const logger = createMockLogger()
  const paymentService = buildPaymentService()
  const outboxDispatcher = {
    enqueueQueue: jest.fn(),
    enqueueWebhook: jest.fn(),
  }
  const paymentServiceFactory = {
    getPaymentService: jest.fn(() => paymentService),
    getPaymentServiceForCapability: jest.fn(() => paymentService),
  }
  const kycService = {
    getKycLink: jest.fn(),
  }
  const prismaProvider = {
    getClient: jest.fn(),
  }

  const service = new TransactionAcceptanceService(
    prismaProvider as unknown as import('../../../../platform/persistence/IDatabaseClientProvider').IDatabaseClientProvider,
    paymentServiceFactory as unknown as import('../../../../modules/payments/application/contracts/IPaymentServiceFactory').IPaymentServiceFactory,
    kycService as unknown as import('../../../../modules/kyc/application/contracts/IKycService').IKycService,
    outboxDispatcher as unknown as import('../../../../platform/outbox/OutboxDispatcher').OutboxDispatcher,
    logger,
  )

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects unsupported KYC countries', () => {
    const normalizeCountry = (service as unknown as {
      normalizeCountry: (country: string) => string
    }).normalizeCountry

    expect(() => normalizeCountry('BR')).toThrow(TransactionValidationError)
  })

  it('normalizes supported countries case-insensitively', () => {
    const normalizeCountry = (service as unknown as {
      normalizeCountry: (country: string) => string
    }).normalizeCountry

    expect(normalizeCountry('co')).toBe('CO')
  })

  it('enforces liquidity thresholds and invokes the provider', async () => {
    const enforceLiquidity = (service as unknown as {
      enforceLiquidity: (svc: ReturnType<typeof buildPaymentService>, amount: number) => Promise<void>
    }).enforceLiquidity

    await expect(enforceLiquidity(paymentService, 50)).rejects.toThrow('liquidity for this method is below the requested amount')
    expect(paymentService.getLiquidity).toHaveBeenCalled()
  })

  it('enforces per-transaction amount bounds', () => {
    const enforceAmountBounds = (service as unknown as {
      enforceTransactionAmountBounds: (
        quote: { targetAmount: number, targetCurrency: TargetCurrency },
        svc: ReturnType<typeof buildPaymentService>,
        method: PaymentMethod,
      ) => void
    }).enforceTransactionAmountBounds

    expect(() => enforceAmountBounds(
      { targetAmount: 5, targetCurrency: TargetCurrency.COP },
      { ...paymentService, MIN_USER_AMOUNT_PER_TRANSACTION: 10 },
      PaymentMethod.BREB,
    )).toThrow('Payouts via BREB must be at least 10 COP. Increase the amount and try again.')

    expect(() => enforceAmountBounds(
      { targetAmount: 150, targetCurrency: TargetCurrency.COP },
      { ...paymentService, MAX_USER_AMOUNT_PER_TRANSACTION: 100 },
      PaymentMethod.BREB,
    )).toThrow('Payouts via BREB cannot exceed 100 COP. Lower the amount or choose another method.')
  })

  it('enforces payment method daily caps via aggregates', async () => {
    const enforcePaymentMethodLimits = (service as unknown as {
      enforcePaymentMethodLimits: (
        prisma: { quote: { aggregate: jest.Mock<Promise<{ _sum: { targetAmount: number } }>, [unknown?]> } },
        quote: { paymentMethod: PaymentMethod, targetAmount: number },
        paymentSvc: ReturnType<typeof buildPaymentService>,
      ) => Promise<void>
    }).enforcePaymentMethodLimits

    const prismaClient = {
      quote: {
        aggregate: jest.fn(async () => ({
          _sum: { targetAmount: 120 },
        })),
      },
    }
    const cappedService = { ...paymentService, MAX_TOTAL_AMOUNT_PER_DAY: 100 }

    await expect(enforcePaymentMethodLimits.call(
      service,
      prismaClient,
      { paymentMethod: PaymentMethod.PIX, targetAmount: 40 },
      cappedService,
    )).rejects.toThrow('already reached today\'s payout limit')
    expect(prismaClient.quote.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      _count: { _all: true },
      _sum: { sourceAmount: true, targetAmount: true },
    }))
  })

  it('rejects users exceeding their personal daily payout total', async () => {
    const enforceUserTransactionLimits = (service as unknown as {
      enforceUserTransactionLimits: (
        prisma: { quote: { aggregate: jest.Mock<Promise<{ _count: { _all: number }, _sum: { targetAmount: number } }>, [unknown?]> } },
        partnerUserId: string,
        quote: { paymentMethod: PaymentMethod, targetAmount: number },
        paymentSvc: ReturnType<typeof buildPaymentService>,
      ) => Promise<void>
    }).enforceUserTransactionLimits

    const prismaClient = {
      quote: {
        aggregate: jest.fn(async () => ({
          _count: { _all: 0 },
          _sum: { targetAmount: 85 },
        })),
      },
    }
    const relaxedLimits = {
      ...paymentService,
      MAX_TOTAL_AMOUNT_PER_DAY: 100,
      MAX_USER_TRANSACTIONS_PER_DAY: 1,
    }

    await expect(enforceUserTransactionLimits.call(
      service,
      prismaClient,
      'partner-user-1',
      { paymentMethod: PaymentMethod.PIX, targetAmount: 20 },
      relaxedLimits,
    )).rejects.toThrow('This transaction would exceed your daily limit for this payment method. Lower the amount or try again tomorrow.')
    expect(prismaClient.quote.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      _count: { _all: true },
      _sum: { sourceAmount: true, targetAmount: true },
    }))
  })

  it('rejects users exceeding their monthly payout totals via caps table', async () => {
    const reserveUserMonthlyLimits = (service as unknown as {
      reserveUserMonthlyLimits: (
        prisma: { $executeRaw: jest.Mock<Promise<number>, [TemplateStringsArray, ...unknown[]]> },
        partnerUserId: string,
        paymentMethod: PaymentMethod,
        targetAmount: number,
        paymentSvc: ReturnType<typeof buildPaymentService>,
      ) => Promise<void>
    }).reserveUserMonthlyLimits

    const prismaClient = {
      $executeRaw: jest.fn(async (sql: TemplateStringsArray, ...params: unknown[]) => {
        void sql
        void params
        return 0
      }),
    }

    await expect(reserveUserMonthlyLimits.call(
      service,
      prismaClient,
      'partner-user-1',
      PaymentMethod.PIX,
      50,
      paymentService,
    )).rejects.toThrow('You reached this month\'s limit for this payment method. Try again next month or choose another method.')
  })

  it('rejects partners exceeding their monthly payout totals via caps table', async () => {
    const reservePartnerMonthlyLimits = (service as unknown as {
      reservePartnerMonthlyLimits: (
        prisma: { $executeRaw: jest.Mock<Promise<number>, [TemplateStringsArray, ...unknown[]]> },
        partnerId: string,
        paymentMethod: PaymentMethod,
        targetAmount: number,
        paymentSvc: ReturnType<typeof buildPaymentService>,
      ) => Promise<void>
    }).reservePartnerMonthlyLimits

    const prismaClient = {
      $executeRaw: jest.fn(async (sql: TemplateStringsArray, ...params: unknown[]) => {
        void sql
        void params
        return 0
      }),
    }

    await expect(reservePartnerMonthlyLimits.call(
      service,
      prismaClient,
      'partner-id',
      PaymentMethod.PIX,
      50,
      paymentService,
    )).rejects.toThrow('This payment method reached this month\'s partner limit. Please try again next month or use another method.')
  })

  it('caps monthly limits using a configurable multiplier', () => {
    const monthlyAmountCap = (service as unknown as {
      monthlyAmountCap: (paymentSvc: ReturnType<typeof buildPaymentService>) => number
    }).monthlyAmountCap
    const monthlyCountCap = (service as unknown as {
      monthlyCountCap: (paymentSvc: ReturnType<typeof buildPaymentService>) => number
    }).monthlyCountCap

    process.env.MONTHLY_LIMIT_MULTIPLIER_DAYS = '10'
    expect(monthlyAmountCap.call(service, paymentService)).toBe(paymentService.MAX_TOTAL_AMOUNT_PER_DAY * 10)
    expect(monthlyCountCap.call(service, paymentService)).toBe(paymentService.MAX_USER_TRANSACTIONS_PER_DAY * 10)
    delete process.env.MONTHLY_LIMIT_MULTIPLIER_DAYS
  })

  it('normalizes non-finite caps for SQL comparisons', () => {
    const dailyAmountCap = (service as unknown as {
      dailyAmountCap: (paymentSvc: ReturnType<typeof buildPaymentService>) => number
    }).dailyAmountCap
    const dailyCountCap = (service as unknown as {
      dailyCountCap: (paymentSvc: ReturnType<typeof buildPaymentService>) => number
    }).dailyCountCap
    const monthlyAmountCap = (service as unknown as {
      monthlyAmountCap: (paymentSvc: ReturnType<typeof buildPaymentService>) => number
    }).monthlyAmountCap
    const monthlyCountCap = (service as unknown as {
      monthlyCountCap: (paymentSvc: ReturnType<typeof buildPaymentService>) => number
    }).monthlyCountCap

    const unboundedService = {
      ...paymentService,
      MAX_TOTAL_AMOUNT_PER_DAY: Number.POSITIVE_INFINITY,
      MAX_USER_TRANSACTIONS_PER_DAY: Number.POSITIVE_INFINITY,
    }

    expect(dailyAmountCap.call(service, unboundedService)).toBe(Number.MAX_SAFE_INTEGER)
    expect(dailyCountCap.call(service, unboundedService)).toBe(2_147_483_647)
    expect(monthlyAmountCap.call(service, unboundedService)).toBe(Number.MAX_SAFE_INTEGER)
    expect(monthlyCountCap.call(service, unboundedService)).toBe(2_147_483_647)
  })

  it('enforces partner KYB threshold using aggregates', async () => {
    const enforcePartnerKybThreshold = (service as unknown as {
      enforcePartnerKybThreshold: (
        prisma: { quote: { aggregate: jest.Mock<Promise<{ _sum: { sourceAmount: null | number } }>, [unknown?]> } },
        partnerId: string,
        sourceAmount: number,
        isKybApproved: boolean,
      ) => Promise<void>
    }).enforcePartnerKybThreshold

    const prismaClient = {
      quote: {
        aggregate: jest.fn(async () => ({ _sum: { sourceAmount: 95 } })),
      },
    }

    await expect(enforcePartnerKybThreshold.call(
      service,
      prismaClient,
      'partner-id',
      10,
      false,
    )).rejects.toThrow('limited to a total of $100 until KYB is approved')
    expect(prismaClient.quote.aggregate).toHaveBeenCalled()
  })

  it('rejects invalid account data when verifying accounts', async () => {
    const ensureAccountIsValid = (service as unknown as {
      ensureAccountIsValid: (
        paymentSvc: ReturnType<typeof buildPaymentService>,
        accountNumber: string,
      ) => Promise<void>
    }).ensureAccountIsValid
    const rejectingService = { ...paymentService, verifyAccount: jest.fn(async () => false) }

    await expect(ensureAccountIsValid(rejectingService, '123'))
      .rejects.toThrow('We could not verify the account number provided. Please double-check the details and try again.')
  })

  it('uses a minimal payload when notifying about missing transactions', async () => {
    const publishUserNotification = (service as unknown as {
      publishUserNotification: (
        prisma: { transaction: { findUnique: jest.Mock<Promise<null>, [Record<string, unknown>?]> } },
        transactionId: string,
        userId: string,
      ) => Promise<void>
    }).publishUserNotification

    const prismaClient = {
      transaction: {
        findUnique: jest.fn(async () => null),
      },
    }

    await publishUserNotification.call(service, prismaClient, 'missing-tx', 'user-9')

    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: JSON.stringify({ id: 'missing-tx' }),
        type: 'transaction.created',
        userId: 'user-9',
      }),
      expect.stringContaining('transaction.created'),
      expect.objectContaining({ client: prismaClient, deliverNow: false }),
    )
  })

  it('publishUserNotification serializes full payload when present', async () => {
    const publishUserNotification = (service as unknown as {
      publishUserNotification: (
        prisma: { transaction: { findUnique: jest.Mock<Promise<unknown>, [Record<string, unknown>?]> } },
        transactionId: string,
        userId: string,
      ) => Promise<void>
    }).publishUserNotification

    const prismaClient = {
      transaction: {
        findUnique: jest.fn(async () => ({
          id: 'tx-abc',
          partnerUser: { partner: { id: 'partner-1', webhookUrl: 'https://example.com' } },
          quote: {
            cryptoCurrency: 'USDC',
            id: 'quote-1',
            network: 'STELLAR',
            paymentMethod: PaymentMethod.BREB,
            sourceAmount: 50,
            targetAmount: 75,
            targetCurrency: TargetCurrency.COP,
          },
          status: TransactionStatus.AWAITING_PAYMENT,
        })),
      },
    }

    await publishUserNotification.call(service, prismaClient, 'tx-abc', 'user-1')

    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.stringContaining('tx-abc'),
        type: 'transaction.created',
        userId: 'user-1',
      }),
      expect.stringContaining('transaction.created'),
      expect.objectContaining({ client: prismaClient, deliverNow: false }),
    )
  })
})
