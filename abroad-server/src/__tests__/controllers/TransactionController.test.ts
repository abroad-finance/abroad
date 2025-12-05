import 'reflect-metadata'
import { NotFound } from 'http-errors'
import { TransactionStatus } from '@prisma/client'

import type { IQueueHandler } from '../../interfaces'
import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IKycService } from '../../interfaces/IKycService'
import type { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'
import type { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'
import type { IPaymentService } from '../../interfaces/IPaymentService'

import { TransactionController } from '../../controllers/TransactionController'

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

  return {
    controller: new TransactionController(dbProvider, paymentServiceFactory, kycService, webhookNotifier, queueHandler),
    prisma,
  }
}

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
    country: 'CO',
    id: 'quote-1',
    partnerId: partner.id,
    paymentMethod: 'PIX',
    sourceAmount: 25,
    targetAmount: 50,
  }

  const buildAcceptController = (
    overrides?: Partial<{
      quote: unknown
      paymentService: {
        MAX_TOTAL_AMOUNT_PER_DAY: number
        MAX_USER_TRANSACTIONS_PER_DAY: number
        getLiquidity: jest.Mock
        verifyAccount: jest.Mock
      }
      needsKyc: boolean
      kycLink: string | null
      transactionFindMany: unknown[][]
      partnerIsKybApproved: boolean
      transactionCreate: () => Promise<unknown>
      transactionFindUnique: () => Promise<unknown>
    }>,
  ) => {
    const quoteValue = overrides?.quote === undefined ? baseQuote : overrides.quote
    const transactionId = '11111111-2222-3333-4444-555555555555'
    const prisma = {
      partnerUser: { upsert: jest.fn().mockResolvedValue({ id: 'pu-1', userId: 'user-1', partnerId: partner.id }) },
      partnerUserKyc: { findFirst: jest.fn().mockResolvedValue({ link: 'kyc-link', status: 'PENDING' }) },
      quote: { findUnique: jest.fn().mockResolvedValue(quoteValue) },
      transaction: {
        create: jest.fn(overrides?.transactionCreate ?? (async () => ({ id: transactionId }))),
        findMany: jest.fn(),
        findUnique: jest.fn(overrides?.transactionFindUnique ?? (async () => ({ id: transactionId, partnerUser: { userId: 'user-1', partnerId: partner.id }, quote: baseQuote }))),
      },
    }

    const paymentService = {
      MAX_TOTAL_AMOUNT_PER_DAY: overrides?.paymentService?.MAX_TOTAL_AMOUNT_PER_DAY ?? 500,
      MAX_USER_TRANSACTIONS_PER_DAY: overrides?.paymentService?.MAX_USER_TRANSACTIONS_PER_DAY ?? 3,
      getLiquidity: overrides?.paymentService?.getLiquidity ?? jest.fn().mockResolvedValue(1_000),
      verifyAccount: overrides?.paymentService?.verifyAccount ?? jest.fn().mockResolvedValue(true),
    }

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

    const transactionsPerCall = overrides?.transactionFindMany ?? [[], [], [], []]
    prisma.transaction.findMany.mockImplementation(async () => transactionsPerCall.shift() ?? [])

    const controller = new TransactionController(dbProvider, paymentServiceFactory, kycService, webhookNotifier, queueHandler)

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
    expect(response).toEqual({ reason: 'Quote not found' })
  })

  it('rejects invalid bank account data', async () => {
    const verifyAccount = jest.fn().mockResolvedValue(false)
    const { controller, prisma } = buildAcceptController({
      paymentService: { MAX_TOTAL_AMOUNT_PER_DAY: 500, MAX_USER_TRANSACTIONS_PER_DAY: 3, getLiquidity: jest.fn().mockResolvedValue(1000), verifyAccount },
    })

    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(prisma.quote.findUnique).toHaveBeenCalled()
    expect(response).toEqual({ reason: 'User account is invalid.' })
  })

  it('returns a KYC link when the partner requires verification', async () => {
    const { controller, kycService } = buildAcceptController({ needsKyc: true, kycLink: 'https://kyc.test' })
    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, needsKyc: true } } as unknown as import('express').Request,
      badRequest,
    )

    expect(kycService.getKycLink).toHaveBeenCalled()
    expect(response).toEqual({ id: null, kycLink: 'https://kyc.test', transaction_reference: null })
  })

  it('enforces per-user daily transaction limits', async () => {
    const priorTransactions = [{ quote: { targetAmount: 10, paymentMethod: baseQuote.paymentMethod }, status: TransactionStatus.PAYMENT_COMPLETED }]
    const { controller, paymentService } = buildAcceptController({
      paymentService: {
        MAX_TOTAL_AMOUNT_PER_DAY: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 1,
        getLiquidity: jest.fn().mockResolvedValue(1_000),
        verifyAccount: jest.fn().mockResolvedValue(true),
      },
      transactionFindMany: [[], priorTransactions, [], []],
    })

    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(paymentService.verifyAccount).toHaveBeenCalled()
    expect(response).toEqual({ reason: 'User has reached the maximum number of transactions for today' })
  })

  it('rejects when liquidity retrieval fails or amount exceeds availability', async () => {
    const liquidityError = jest.fn(async () => {
      throw new Error('liquidity unavailable')
    })
    const { controller } = buildAcceptController({
      paymentService: {
        MAX_TOTAL_AMOUNT_PER_DAY: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 3,
        getLiquidity: liquidityError,
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
      reason: 'This payment method does not have enough liquidity for the requested amount',
    })
  })

  it('limits partners without KYB approval to small totals', async () => {
    const partnerTransactions = [
      { quote: { sourceAmount: 60, paymentMethod: baseQuote.paymentMethod }, status: TransactionStatus.PAYMENT_COMPLETED },
      { quote: { sourceAmount: 50, paymentMethod: baseQuote.paymentMethod }, status: TransactionStatus.PAYMENT_COMPLETED },
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
      reason: 'Partner KYB not approved. Maximum total amount of $100 allowed.',
    })
  })

  it('creates a transaction and notifies downstream systems', async () => {
    const queueHandlerPost = jest.fn().mockResolvedValue(undefined)
    const webhookNotifier = { notifyWebhook: jest.fn() } as unknown as IWebhookNotifier
    const fullTransactionId = '12345678-9012-3456-7890-123456789012'
    const expectedReference = Buffer.from(fullTransactionId.replace(/-/g, ''), 'hex').toString('base64')
    const fullTransaction = { id: fullTransactionId, partnerUser: { id: 'pu-1', userId: 'user-1', partnerId: partner.id }, quote: baseQuote }

    const prisma = {
      partnerUser: { upsert: jest.fn().mockResolvedValue({ id: 'pu-1', userId: 'user-1', partnerId: partner.id }) },
      partnerUserKyc: { findFirst: jest.fn().mockResolvedValue({ link: 'kyc-link', status: 'APPROVED' }) },
      quote: { findUnique: jest.fn().mockResolvedValue(baseQuote) },
      transaction: {
        create: jest.fn().mockResolvedValue({ id: fullTransaction.id }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(fullTransaction),
      },
    }
    const paymentService = {
      MAX_TOTAL_AMOUNT_PER_DAY: 500,
      MAX_USER_TRANSACTIONS_PER_DAY: 3,
      getLiquidity: jest.fn().mockResolvedValue(1_000),
      verifyAccount: jest.fn().mockResolvedValue(true),
    }
    const controller = new TransactionController(
      { getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient) },
      { getPaymentService: jest.fn().mockReturnValue(paymentService as unknown as IPaymentService) },
      { getKycLink: jest.fn().mockResolvedValue(null) },
      webhookNotifier,
      { postMessage: queueHandlerPost, subscribeToQueue: jest.fn() },
    )

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

    expect(response).toEqual({ reason: 'Transaction creation failed' })
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
          partnerUser: { id: 'pu-1', userId: 'user-1', partnerId: 'partner-1' },
          partnerUserId: 'pu-1',
          quote: { partnerId: 'partner-1' },
          status: TransactionStatus.PAYMENT_COMPLETED,
        }),
      },
    }
    const controller = new TransactionController(
      { getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient) },
      { getPaymentService: jest.fn() },
      { getKycLink: jest.fn() },
      { notifyWebhook: jest.fn() },
      { postMessage: jest.fn(), subscribeToQueue: jest.fn() },
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
