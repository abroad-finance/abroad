import { Country, PaymentMethod, TargetCurrency } from '@prisma/client'

import { TransactionAcceptanceService, TransactionValidationError } from '../../../../modules/transactions/application/TransactionAcceptanceService'
import { createMockLogger } from '../../../setup/mockFactories'

const prismaProvider = {
  getClient: jest.fn(),
}

const queueHandler = {
  closeAllSubscriptions: jest.fn(),
  postMessage: jest.fn(),
  subscribeToQueue: jest.fn(),
}

const webhookNotifier = {
  notifyWebhook: jest.fn(),
}

const kycService = {
  getKycLink: jest.fn(),
}

const paymentService = {
  banks: [],
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
}

const paymentServiceFactory = {
  getPaymentService: jest.fn(() => paymentService),
}

const logger = createMockLogger()

describe('TransactionAcceptanceService helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const service = new TransactionAcceptanceService(
    prismaProvider,
    paymentServiceFactory,
    kycService,
    webhookNotifier,
    queueHandler,
    logger,
  )

  it('rejects unsupported KYC countries', async () => {
    const normalizeCountry = (service as unknown as {
      normalizeCountry: (country: string) => Country
    }).normalizeCountry

    expect(() => normalizeCountry('BR')).toThrow(TransactionValidationError)
  })

  it('normalizes supported countries case-insensitively', () => {
    const normalizeCountry = (service as unknown as {
      normalizeCountry: (country: string) => Country
    }).normalizeCountry

    expect(normalizeCountry('co')).toBe(Country.CO)
  })

  it('enforces liquidity thresholds', async () => {
    const enforceLiquidity = (service as unknown as {
      enforceLiquidity: (svc: typeof paymentService, amount: number) => Promise<void>
    }).enforceLiquidity

    await expect(enforceLiquidity(paymentService, 50)).rejects.toThrow('liquidity for this method is below the requested amount')
    expect(paymentService.getLiquidity).toHaveBeenCalled()
  })

  it('enforces per-transaction amount bounds', () => {
    const enforceAmountBounds = (service as unknown as {
      enforceTransactionAmountBounds: (quote: { targetAmount: number, targetCurrency: TargetCurrency }, svc: typeof paymentService, method: PaymentMethod) => void
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

  it('logs failures when publishing user notifications', async () => {
    const publishUserNotification = (service as unknown as {
      publishUserNotification: (prisma: {
        transaction: { findUnique: jest.Mock<Promise<unknown>, [Record<string, unknown>?]> }
      }, transactionId: string, userId: string) => Promise<void>
    }).publishUserNotification

    const prismaClient = {
      transaction: {
        findUnique: jest.fn(async () => ({ id: 'tx-id', partnerUser: { partner: {} }, quote: {} })),
      },
    }
    queueHandler.postMessage.mockRejectedValueOnce(new Error('queue unavailable'))

    await publishUserNotification.call(service, prismaClient, 'tx-id', 'user-1')

    expect(queueHandler.postMessage).toHaveBeenCalledTimes(1)
    expect(queueHandler.postMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      payload: expect.any(String),
      type: 'transaction.created',
      userId: 'user-1',
    }))
  })

  it('rejects accepting transactions for disabled payment services', async () => {
    const disabledPaymentService = { ...paymentService, isEnabled: false }
    const disabledFactory = { getPaymentService: jest.fn(() => disabledPaymentService) }
    const quoteId = 'quote-id'
    const request = {
      accountNumber: '123',
      bankCode: '001',
      quoteId,
      userId: 'user-id',
    }
    const partnerContext = {
      id: 'partner-id',
      isKybApproved: false,
      needsKyc: false,
      webhookUrl: 'https://webhook',
    }
    const prismaClient = {
      quote: {
        findUnique: jest.fn(async () => ({
          country: Country.CO,
          id: quoteId,
          partnerId: partnerContext.id,
          paymentMethod: PaymentMethod.BREB,
          sourceAmount: 10,
          targetAmount: 10,
          targetCurrency: TargetCurrency.COP,
        })),
      },
    }
    prismaProvider.getClient.mockResolvedValue(prismaClient as unknown as import('@prisma/client').PrismaClient)

    const acceptanceService = new TransactionAcceptanceService(
      prismaProvider,
      disabledFactory as unknown as typeof paymentServiceFactory,
      kycService,
      webhookNotifier,
      queueHandler,
      createMockLogger(),
    )

    await expect(acceptanceService.acceptTransaction(request, partnerContext)).rejects.toThrow('Payments via BREB are temporarily unavailable')
    expect(disabledFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.BREB)
    expect(disabledPaymentService.verifyAccount).not.toHaveBeenCalled()
  })

  it('allows KYB-pending partners below the cumulative threshold to proceed', async () => {
    const enforcePartnerKybThreshold = (service as unknown as {
      enforcePartnerKybThreshold: (
        prisma: { transaction: { findMany: jest.Mock<Promise<Array<{ quote: { sourceAmount: number } }>>, [unknown?]> } },
        partnerId: string,
        sourceAmount: number,
        isKybApproved: boolean,
      ) => Promise<void>
    }).enforcePartnerKybThreshold

    const prismaClient = {
      transaction: {
        findMany: jest.fn(async () => [
          { quote: { sourceAmount: 40 } },
          { quote: { sourceAmount: 35 } },
        ]),
      },
    }

    await expect(enforcePartnerKybThreshold.call(
      service,
      prismaClient,
      'partner-id',
      20,
      false,
    )).resolves.toBeUndefined()
    expect(prismaClient.transaction.findMany).toHaveBeenCalled()
  })

  it('enforces payment method daily caps', async () => {
    const enforcePaymentMethodLimits = (service as unknown as {
      enforcePaymentMethodLimits: (
        prisma: { transaction: { findMany: jest.Mock<Promise<Array<{ quote: { targetAmount: number } }>>, [unknown?]> } },
        quote: { paymentMethod: PaymentMethod, targetAmount: number },
        paymentSvc: typeof paymentService,
      ) => Promise<void>
    }).enforcePaymentMethodLimits

    const prismaClient = {
      transaction: {
        findMany: jest.fn(async () => [
          { quote: { targetAmount: 70 } },
          { quote: { targetAmount: 50 } },
        ]),
      },
    }
    const cappedService = { ...paymentService, MAX_TOTAL_AMOUNT_PER_DAY: 100 }

    await expect(enforcePaymentMethodLimits.call(
      service,
      prismaClient,
      { paymentMethod: PaymentMethod.PIX, targetAmount: 40 },
      cappedService,
    )).rejects.toThrow('already reached today\'s payout limit')
  })

  it('rejects users exceeding their personal daily payout total', async () => {
    const enforceUserTransactionLimits = (service as unknown as {
      enforceUserTransactionLimits: (
        prisma: { transaction: { findMany: jest.Mock<Promise<Array<{ quote: { targetAmount: number } }>>, [unknown?]> } },
        partnerUserId: string,
        quote: { paymentMethod: PaymentMethod, targetAmount: number },
        paymentSvc: typeof paymentService,
      ) => Promise<void>
    }).enforceUserTransactionLimits

    const prismaClient = {
      transaction: {
        findMany: jest.fn(async () => [
          { quote: { targetAmount: 85 } },
        ]),
      },
    }
    const relaxedLimits = {
      ...paymentService,
      MAX_TOTAL_AMOUNT_PER_DAY: 100,
      MAX_USER_TRANSACTIONS_PER_DAY: 5,
    }

    await expect(enforceUserTransactionLimits.call(
      service,
      prismaClient,
      'partner-user-1',
      { paymentMethod: PaymentMethod.PIX, targetAmount: 20 },
      relaxedLimits,
    )).rejects.toThrow('This transaction would exceed your daily limit for this payment method. Lower the amount or try again tomorrow.')
  })

  it('rejects invalid bank data when verifying accounts', async () => {
    const ensureAccountIsValid = (service as unknown as {
      ensureAccountIsValid: (
        paymentSvc: typeof paymentService,
        accountNumber: string,
        bankCode: string | undefined,
      ) => Promise<void>
    }).ensureAccountIsValid
    const rejectingService = { ...paymentService, verifyAccount: jest.fn(async () => false) }

    await expect(ensureAccountIsValid(rejectingService, '123', undefined))
      .rejects.toThrow('We could not verify the account number and bank code provided. Please double-check the details and try again.')
  })

  it('creates transactions with optional bank codes and notifies subscribers', async () => {
    const createTransaction = (service as unknown as {
      createTransaction: (
        prisma: {
          transaction: {
            create: jest.Mock<Promise<{ id: string }>, [Record<string, unknown>]>,
            findUnique: jest.Mock<Promise<{ id: string, partnerUser: { partner: object }, quote: object } | null>, [Record<string, unknown>?]>,
          }
        },
        input: {
          accountNumber: string
          bankCode?: string
          partner: { webhookUrl: string }
          partnerUserId: string
          paymentMethod: PaymentMethod
          paymentService: typeof paymentService
          qrCode?: null | string
          quoteId: string
          taxId?: string
          userId: string
        },
      ) => Promise<{ id: string | null, kycLink: string | null, transactionReference: string | null }>
    }).createTransaction

    const prismaClient = {
      transaction: {
        create: jest.fn(async (_data: Record<string, unknown>) => ({ id: 'tx-abc' })),
        findUnique: jest.fn(async (_query?: Record<string, unknown>) => ({
          id: 'tx-abc',
          partnerUser: { partner: {} },
          quote: {},
        })),
      },
    }
    const response = await createTransaction.call(
      service,
      prismaClient,
      {
        accountNumber: '123',
        partner: { webhookUrl: 'https://webhook.test' },
        partnerUserId: 'pu-1',
        paymentMethod: PaymentMethod.BREB,
        paymentService,
        qrCode: null,
        quoteId: 'quote-1',
        taxId: undefined,
        userId: 'user-1',
      },
    )

    expect(prismaClient.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ bankCode: '' }),
    })
    expect(webhookNotifier.notifyWebhook).toHaveBeenCalledWith('https://webhook.test', expect.any(Object))
    expect(queueHandler.postMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'transaction.created' }))
    expect(response.transactionReference).toBeDefined()
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
        findUnique: jest.fn(async (_query?: Record<string, unknown>) => null),
      },
    }

    await publishUserNotification.call(service, prismaClient, 'missing-tx', 'user-9')

    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payload: JSON.stringify({ id: 'missing-tx' }) }),
    )
  })
})
