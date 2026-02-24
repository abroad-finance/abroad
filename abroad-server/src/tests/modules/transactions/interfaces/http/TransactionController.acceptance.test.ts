import 'reflect-metadata'
import { KYCTier, TransactionStatus } from '@prisma/client'

import { QueueName } from '../../../../../platform/messaging/queues'
import { baseQuote, buildAcceptController, partner, requestBody } from './transactionControllerAcceptance.fixtures'
import { createBadRequestResponder } from './transactionControllerTestUtils'

const badRequest = createBadRequestResponder()

beforeEach(() => {
  badRequest.mockClear()
})

describe('TransactionController acceptance flows', () => {
  it('returns bad request when quote is missing', async () => {
    const { controller, prisma } = buildAcceptController({ quote: null })
    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(prisma.quote.findUnique).toHaveBeenCalled()
    expect(response).toEqual({ reason: 'We could not find a valid quote for this request. Please generate a new quote and try again.' })
  })

  it('rejects invalid account data', async () => {
    const verifyAccount = jest.fn().mockResolvedValue(false)
    const { controller, prisma } = buildAcceptController({
      paymentService: { getLiquidity: jest.fn().mockResolvedValue(1000), MAX_TOTAL_AMOUNT_PER_DAY: 500, MAX_USER_TRANSACTIONS_PER_DAY: 3, verifyAccount },
    })

    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(prisma.quote.findUnique).toHaveBeenCalled()
    expect(response).toEqual({ reason: 'We could not verify the account number provided. Please double-check the details and try again.' })
  })

  it('returns a KYC link when the partner requires verification', async () => {
    const { controller, kycService, prisma } = buildAcceptController({
      kycLink: 'https://kyc.test',
      quote: { ...baseQuote, sourceAmount: 30 },
    })
    prisma.quote.aggregate
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { sourceAmount: 30, targetAmount: 0 } })
      .mockResolvedValue({ _count: { _all: 0 }, _sum: { sourceAmount: 0, targetAmount: 0 } })
    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, needsKyc: true } } as unknown as import('express').Request,
      badRequest,
    )

    expect(kycService.getKycLink).toHaveBeenCalled()
    expect(response).toEqual({ id: null, kycLink: 'https://kyc.test', payment_context: null, transaction_reference: null })
  })

  it('skips KYC when the user already meets the required tier', async () => {
    const { controller, kycService } = buildAcceptController({
      approvedKycTier: KYCTier.ENHANCED,
      quote: { ...baseQuote, sourceAmount: 30 },
    })
    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, needsKyc: true } } as unknown as import('express').Request,
      badRequest,
    )

    expect(kycService.getKycLink).not.toHaveBeenCalled()
    expect(response).toEqual({
      id: '11111111-2222-3333-4444-555555555555',
      kycLink: null,
      payment_context: null,
      transaction_reference: Buffer.from('11111111222233334444555555555555', 'hex').toString('base64'),
    })
  })

  it('fails when KYC is required but no link can be generated', async () => {
    const { controller } = buildAcceptController({
      quote: { ...baseQuote, sourceAmount: 30 },
    })
    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, needsKyc: true } } as unknown as import('express').Request,
      badRequest,
    )

    expect(response).toEqual({
      reason: 'We could not start the verification process right now. Please try again in a few moments.',
    })
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
      payment_context: null,
      transaction_reference: expectedReference,
    })
  })

  it('enforces per-user daily transaction limits', async () => {
    const priorTransactions = [{ quote: { paymentMethod: baseQuote.paymentMethod, targetAmount: 10 }, status: TransactionStatus.PAYMENT_COMPLETED }]
    const { controller, paymentService, prisma } = buildAcceptController({
      paymentService: {
        getLiquidity: jest.fn().mockResolvedValue(1_000),
        MAX_TOTAL_AMOUNT_PER_DAY: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 1,
        verifyAccount: jest.fn().mockResolvedValue(true),
      },
      transactionFindMany: [[], priorTransactions, [], []],
    })
    prisma.quote.aggregate
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { sourceAmount: 0, targetAmount: 0 } })
      .mockResolvedValue({ _count: { _all: 1 }, _sum: { sourceAmount: 0, targetAmount: 0 } })

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
    const { controller, prisma } = buildAcceptController({
      transactionFindMany: [[], [], [], partnerTransactions],
    })
    prisma.quote.aggregate
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { sourceAmount: 0, targetAmount: 0 } })
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { sourceAmount: 0, targetAmount: 0 } })
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { sourceAmount: 0, targetAmount: 0 } })
      .mockResolvedValue({ _count: { _all: 0 }, _sum: { sourceAmount: 95, targetAmount: 0 } })

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
    const { controller, outboxDispatcher, prisma } = buildAcceptController()

    const response = await controller.acceptTransaction(requestBody, { user: partner } as unknown as import('express').Request, badRequest)

    expect(prisma.transaction.create).toHaveBeenCalled()
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalled()
    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(
      QueueName.USER_NOTIFICATION,
      expect.objectContaining({ type: 'transaction.created' }),
      expect.any(String),
      expect.objectContaining({ deliverNow: false }),
    )
    expect(response.transaction_reference).toBeDefined()
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
