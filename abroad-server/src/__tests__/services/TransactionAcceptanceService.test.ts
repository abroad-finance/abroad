import { Country, PaymentMethod, TargetCurrency } from '@prisma/client'

import { TransactionAcceptanceService, TransactionValidationError } from '../../services/TransactionAcceptanceService'

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
  onboardUser: jest.fn(),
  percentageFee: 0,
  sendPayment: jest.fn(),
  verifyAccount: jest.fn(),
}

const paymentServiceFactory = {
  getPaymentService: jest.fn(() => paymentService),
}

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

    await expect(enforceLiquidity(paymentService, 50)).rejects.toThrow('does not have enough liquidity')
    expect(paymentService.getLiquidity).toHaveBeenCalled()
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
    )

    await expect(acceptanceService.acceptTransaction(request, partnerContext)).rejects.toThrow('Payment method MOVII is currently unavailable')
    expect(disabledFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.MOVII)
    expect(disabledPaymentService.verifyAccount).not.toHaveBeenCalled()
  })
})
