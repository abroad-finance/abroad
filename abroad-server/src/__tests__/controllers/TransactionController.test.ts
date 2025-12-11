import 'reflect-metadata'
import { Country, PaymentMethod, TargetCurrency, TransactionStatus } from '@prisma/client'
import { NotFound } from 'http-errors'

import type { IQueueHandler } from '../../interfaces'
import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IKycService } from '../../interfaces/IKycService'
import type { IPaymentService } from '../../interfaces/IPaymentService'
import type { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'
import type { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'

import { TransactionController } from '../../controllers/TransactionController'
import { TransactionAcceptanceService } from '../../services/TransactionAcceptanceService'
import { TransactionStatusService } from '../../services/TransactionStatusService'
import { createMockLogger } from '../setup/mockFactories'

const buildController = () => {
  const prisma = {
    transaction: {
      findUnique: jest.fn(),
    },
  }
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const paymentServiceFactory: IPaymentServiceFactory = {
    getPaymentService: jest.fn(),
  }
  const kycService: IKycService = {
    getKycLink: jest.fn(),
  }
  const webhookNotifier: IWebhookNotifier = {
    notifyWebhook: jest.fn(),
  }
  const queueHandler: IQueueHandler = {
    postMessage: jest.fn(),
    subscribeToQueue: jest.fn(),
  }
  const logger = createMockLogger()

  const acceptanceService = new TransactionAcceptanceService(
    dbProvider,
    paymentServiceFactory,
    kycService,
    webhookNotifier,
    queueHandler,
    logger,
  )
  const statusService = new TransactionStatusService(dbProvider)

  return {
    controller: new TransactionController(acceptanceService, statusService),
    prisma,
  }
}

const buildPaymentService = (overrides?: Partial<jest.Mocked<IPaymentService>>): jest.Mocked<IPaymentService> => ({
  banks: [],
  currency: TargetCurrency.COP,
  fixedFee: 0,
  getLiquidity: jest.fn(async () => 1_000),
  isAsync: false,
  isEnabled: true,
  MAX_TOTAL_AMOUNT_PER_DAY: 500,
  MAX_USER_AMOUNT_PER_DAY: 500,
  MAX_USER_AMOUNT_PER_TRANSACTION: 500,
  MAX_USER_TRANSACTIONS_PER_DAY: 3,
  onboardUser: jest.fn(async ({ account }: { account: string }) => ({ message: undefined, success: Boolean(account) })),
  percentageFee: 0,
  sendPayment: jest.fn(async (params: {
    account: string
    bankCode: string
    id: string
    qrCode?: null | string
    value: number
  }) => ({ success: Boolean(params.account && params.bankCode && params.value), transactionId: 'tx-id' })),
  verifyAccount: jest.fn(async ({ account, bankCode }: { account: string, bankCode: string }) => Boolean(account && bankCode)),
  ...(overrides ?? {}),
})

const badRequest = jest.fn((status: number, payload: { reason: string }) => payload)
const authRequest = (partnerId: string) => ({ user: { id: partnerId } } as unknown as import('express').Request)

beforeEach(() => {
  badRequest.mockClear()
})

describe('TransactionController minimal branches', () => {
  it('rejects invalid acceptTransaction payloads', async () => {
    const { controller } = buildController()

    const response = await controller.acceptTransaction(
      { account_number: '', bank_code: '', quote_id: '', user_id: '' },
      authRequest('partner-1'),
      badRequest,
    )

    expect(badRequest).toHaveBeenCalled()
    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
  })

  it('throws when transaction is not found', async () => {
    const { controller, prisma } = buildController()
    prisma.transaction.findUnique.mockResolvedValueOnce(null)

    await expect(controller.getTransactionStatus('missing-tx', authRequest('partner-1'))).rejects.toBeInstanceOf(NotFound)
  })

  it('throws when transaction belongs to another partner', async () => {
    const { controller, prisma } = buildController()
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-2',
      onChainId: null,
      partnerUser: { id: 'pu-1', userId: 'user-1' },
      partnerUserId: 'pu-1',
      quote: { partnerId: 'other-partner' },
      status: 'PAYMENT_COMPLETED',
    })

    await expect(controller.getTransactionStatus('tx-2', authRequest('partner-1'))).rejects.toBeInstanceOf(NotFound)
  })
})

describe('TransactionController acceptance flows', () => {
  const partner = {
    id: 'partner-1',
    isKybApproved: true,
    needsKyc: false,
    webhookUrl: 'https://webhook.test',
  }

  const baseQuote = {
    country: Country.CO,
    id: 'quote-1',
    partnerId: partner.id,
    paymentMethod: PaymentMethod.PIX,
    sourceAmount: 25,
    targetAmount: 50,
  }

  const buildAcceptController = (
    overrides?: Partial<{
      kycLink: null | string
      needsKyc: boolean
      partnerIsKybApproved: boolean
      paymentService: Partial<jest.Mocked<IPaymentService>>
      quote: unknown
      transactionCreate: () => Promise<unknown>
      transactionFindMany: unknown[][]
      transactionFindUnique: () => Promise<unknown>
    }>,
  ) => {
    const quoteValue = overrides?.quote === undefined ? baseQuote : overrides.quote
    const transactionId = '11111111-2222-3333-4444-555555555555'
    const prisma = {
      partnerUser: { upsert: jest.fn().mockResolvedValue({ id: 'pu-1', partnerId: partner.id, userId: 'user-1' }) },
      partnerUserKyc: { findFirst: jest.fn().mockResolvedValue({ link: 'kyc-link', status: 'PENDING' }) },
      quote: { findUnique: jest.fn().mockResolvedValue(quoteValue) },
      transaction: {
        create: jest.fn(overrides?.transactionCreate ?? (async () => ({ id: transactionId }))),
        findMany: jest.fn(),
        findUnique: jest.fn(overrides?.transactionFindUnique ?? (async () => ({ id: transactionId, partnerUser: { partnerId: partner.id, userId: 'user-1' }, quote: baseQuote }))),
      },
    }

    const paymentService = buildPaymentService(overrides?.paymentService)

    const paymentServiceFactory: IPaymentServiceFactory = {
      getPaymentService: jest.fn().mockReturnValue(paymentService as unknown as IPaymentService),
    }
    const kycService: IKycService = {
      getKycLink: jest.fn().mockResolvedValue(overrides?.kycLink ?? null),
    }
    const webhookNotifier: IWebhookNotifier = {
      notifyWebhook: jest.fn(),
    }
    const queueHandler: IQueueHandler = {
      postMessage: jest.fn().mockResolvedValue(undefined),
      subscribeToQueue: jest.fn(),
    }
    const dbProvider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
    }
    const logger = createMockLogger()

    const acceptanceService = new TransactionAcceptanceService(
      dbProvider,
      paymentServiceFactory,
      kycService,
      webhookNotifier,
      queueHandler,
      logger,
    )
    const statusService = new TransactionStatusService(dbProvider)

    const transactionsPerCall = overrides?.transactionFindMany ?? [[], [], [], []]
    prisma.transaction.findMany.mockImplementation(async () => transactionsPerCall.shift() ?? [])

    const controller = new TransactionController(acceptanceService, statusService)

    return {
      controller,
      kycService,
      paymentService,
      prisma,
      queueHandler,
      webhookNotifier,
    }
  }

  const requestBody = {
    account_number: '123',
    bank_code: '001',
    quote_id: baseQuote.id,
    user_id: 'user-1',
  }

  it('returns bad request when quote is missing', async () => {
    const { controller, prisma } = buildAcceptController({ quote: null })
    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(prisma.quote.findUnique).toHaveBeenCalled()
    expect(response).toEqual({ reason: 'We could not find a valid quote for this request. Please generate a new quote and try again.' })
  })

  it('rejects invalid bank account data', async () => {
    const verifyAccount = jest.fn().mockResolvedValue(false)
    const { controller, prisma } = buildAcceptController({
      paymentService: { getLiquidity: jest.fn().mockResolvedValue(1000), MAX_TOTAL_AMOUNT_PER_DAY: 500, MAX_USER_TRANSACTIONS_PER_DAY: 3, verifyAccount },
    })

    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(prisma.quote.findUnique).toHaveBeenCalled()
    expect(response).toEqual({ reason: 'We could not verify the account number and bank code provided. Please double-check the details and try again.' })
  })

  it('returns a KYC link when the partner requires verification', async () => {
    const monthlyHistory = [{ quote: { paymentMethod: baseQuote.paymentMethod, sourceAmount: 10 }, status: TransactionStatus.PAYMENT_COMPLETED }]
    const { controller, kycService } = buildAcceptController({
      kycLink: 'https://kyc.test',
      needsKyc: true,
      transactionFindMany: [monthlyHistory, [], []],
    })
    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, needsKyc: true } } as unknown as import('express').Request,
      badRequest,
    )

    expect(kycService.getKycLink).toHaveBeenCalled()
    expect(response).toEqual({ id: null, kycLink: 'https://kyc.test', transaction_reference: null })
  })

  it('bypasses KYC when cumulative volume is within the exemption window', async () => {
    const { controller, kycService } = buildAcceptController()
    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, needsKyc: true } } as unknown as import('express').Request,
      badRequest,
    )

    const expectedReference = Buffer.from('11111111222233334444555555555555', 'hex').toString('base64')

    expect(kycService.getKycLink).not.toHaveBeenCalled()
    expect(response).toEqual({
      id: '11111111-2222-3333-4444-555555555555',
      kycLink: null,
      transaction_reference: expectedReference,
    })
  })

  it('enforces per-user daily transaction limits', async () => {
    const priorTransactions = [{ quote: { paymentMethod: baseQuote.paymentMethod, targetAmount: 10 }, status: TransactionStatus.PAYMENT_COMPLETED }]
    const { controller, paymentService } = buildAcceptController({
      paymentService: {
        getLiquidity: jest.fn().mockResolvedValue(1_000),
        MAX_TOTAL_AMOUNT_PER_DAY: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 1,
        verifyAccount: jest.fn().mockResolvedValue(true),
      },
      transactionFindMany: [[], priorTransactions, [], []],
    })

    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(paymentService.verifyAccount).toHaveBeenCalled()
    expect(response).toEqual({ reason: 'You reached the maximum number of transactions allowed today. Please try again tomorrow.' })
  })

  it('rejects when liquidity retrieval fails or amount exceeds availability', async () => {
    const liquidityError = jest.fn(async () => {
      throw new Error('liquidity unavailable')
    })
    const { controller } = buildAcceptController({
      paymentService: {
        getLiquidity: liquidityError,
        MAX_TOTAL_AMOUNT_PER_DAY: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 3,
        verifyAccount: jest.fn().mockResolvedValue(true),
      },
      transactionFindMany: [[], [], [], []],
    })

    const response = await controller.acceptTransaction(
      { ...requestBody, account_number: '123' },
      { user: partner } as unknown as import('express').Request,
      badRequest,
    )

    expect(response).toEqual({
      reason: 'We cannot process this payout because liquidity for this method is below the requested amount. Try a smaller amount or choose another payment method.',
    })
  })

  it('limits partners without KYB approval to small totals', async () => {
    const partnerTransactions = [
      { quote: { paymentMethod: baseQuote.paymentMethod, sourceAmount: 60 }, status: TransactionStatus.PAYMENT_COMPLETED },
      { quote: { paymentMethod: baseQuote.paymentMethod, sourceAmount: 50 }, status: TransactionStatus.PAYMENT_COMPLETED },
    ]
    const { controller } = buildAcceptController({
      partnerIsKybApproved: false,
      transactionFindMany: [[], [], [], partnerTransactions],
    })

    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, isKybApproved: false } } as unknown as import('express').Request,
      badRequest,
    )

    expect(response).toEqual({
      reason: 'This partner is limited to a total of $100 until KYB is approved. Please complete KYB to raise the limit.',
    })
  })

  it('creates a transaction and notifies downstream systems', async () => {
    const queueHandlerPost = jest.fn().mockResolvedValue(undefined)
    const webhookNotifier = { notifyWebhook: jest.fn() } as unknown as IWebhookNotifier
    const fullTransactionId = '12345678-9012-3456-7890-123456789012'
    const expectedReference = Buffer.from(fullTransactionId.replace(/-/g, ''), 'hex').toString('base64')
    const fullTransaction = { id: fullTransactionId, partnerUser: { id: 'pu-1', partnerId: partner.id, userId: 'user-1' }, quote: baseQuote }

    const prisma = {
      partnerUser: { upsert: jest.fn().mockResolvedValue({ id: 'pu-1', partnerId: partner.id, userId: 'user-1' }) },
      partnerUserKyc: { findFirst: jest.fn().mockResolvedValue({ link: 'kyc-link', status: 'APPROVED' }) },
      quote: { findUnique: jest.fn().mockResolvedValue(baseQuote) },
      transaction: {
        create: jest.fn().mockResolvedValue({ id: fullTransaction.id }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(fullTransaction),
      },
    }
    const paymentService = buildPaymentService({
      getLiquidity: jest.fn().mockResolvedValue(1_000),
      verifyAccount: jest.fn().mockResolvedValue(true),
    })
    const dbProvider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
    }
    const paymentServiceFactory: IPaymentServiceFactory = {
      getPaymentService: jest.fn().mockReturnValue(paymentService),
    }
    const kycService: IKycService = {
      getKycLink: jest.fn().mockResolvedValue(null),
    }
    const queueHandler: IQueueHandler = { postMessage: queueHandlerPost, subscribeToQueue: jest.fn() }
    const logger = createMockLogger()
    const acceptanceService = new TransactionAcceptanceService(
      dbProvider,
      paymentServiceFactory,
      kycService,
      webhookNotifier,
      queueHandler,
      logger,
    )
    const statusService = new TransactionStatusService(dbProvider)
    const controller = new TransactionController(acceptanceService, statusService)

    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(prisma.transaction.create).toHaveBeenCalled()
    expect(webhookNotifier.notifyWebhook).toHaveBeenCalled()
    expect(queueHandlerPost).toHaveBeenCalledWith(
      'user-notification',
      expect.objectContaining({ type: 'transaction.created' }),
    )
    expect(response.transaction_reference).toBe(expectedReference)
  })

  it('surfaces create failures as bad requests', async () => {
    const createFailure = jest.fn(async () => {
      throw new Error('db down')
    })
    const { controller } = buildAcceptController({
      transactionCreate: createFailure,
    })

    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(response).toEqual({ reason: 'We could not create your transaction right now. Please try again in a few moments.' })
  })
})

describe('TransactionController status lookup', () => {
  it('returns transaction status for matching partner', async () => {
    const transactionId = '11111111-2222-3333-4444-555555555555'
    const expectedReference = Buffer.from(transactionId.replace(/-/g, ''), 'hex').toString('base64')
    const prisma = {
      partnerUserKyc: { findFirst: jest.fn().mockResolvedValue({ link: 'kyc-link', status: 'PENDING' }) },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: transactionId,
          onChainId: 'on-chain-id',
          partnerUser: { id: 'pu-1', partnerId: 'partner-1', userId: 'user-1' },
          partnerUserId: 'pu-1',
          quote: { partnerId: 'partner-1' },
          status: TransactionStatus.PAYMENT_COMPLETED,
        }),
      },
    }
    const dbProvider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
    }
    const statusService = new TransactionStatusService(dbProvider)
    const controller = new TransactionController(
      { acceptTransaction: jest.fn() } as unknown as TransactionAcceptanceService,
      statusService,
    )

    const response = await controller.getTransactionStatus(
      'tx-1111-2222-3333-444455556666',
      authRequest('partner-1'),
    )

    expect(prisma.transaction.findUnique).toHaveBeenCalled()
    expect(response.transaction_reference).toBe(expectedReference)
    expect(response.kycLink).toBe('kyc-link')
  })
})
