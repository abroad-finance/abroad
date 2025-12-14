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
      PaymentMethod.MOVII,
    )).toThrow('Payouts via MOVII must be at least 10 COP. Increase the amount and try again.')

    expect(() => enforceAmountBounds(
      { targetAmount: 150, targetCurrency: TargetCurrency.COP },
      { ...paymentService, MAX_USER_AMOUNT_PER_TRANSACTION: 100 },
      PaymentMethod.MOVII,
    )).toThrow('Payouts via MOVII cannot exceed 100 COP. Lower the amount or choose another method.')
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
          paymentMethod: PaymentMethod.MOVII,
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

    await expect(acceptanceService.acceptTransaction(request, partnerContext)).rejects.toThrow('Payments via MOVII are temporarily unavailable')
    expect(disabledFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.MOVII)
    expect(disabledPaymentService.verifyAccount).not.toHaveBeenCalled()
  })
})
