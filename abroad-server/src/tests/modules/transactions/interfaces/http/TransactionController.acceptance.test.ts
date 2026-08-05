import 'reflect-metadata'
import { PaymentMethod, TargetCurrency, TransactionOrigin, TransactionStatus } from '@prisma/client'

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

  it('accepts a PIX QR code without an account number', async () => {
    const verifyAccount = jest.fn().mockResolvedValue(false)
    const { controller, paymentService, prisma } = buildAcceptController({
      paymentService: {
        getLiquidity: jest.fn().mockResolvedValue(1000),
        MAX_TOTAL_AMOUNT_PER_DAY: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 3,
        verifyAccount,
      },
    })

    const response = await controller.acceptTransaction(
      {
        qr_code: '  qr-payload  ',
        quote_id: requestBody.quote_id,
        user_id: requestBody.user_id,
      },
      { user: partner } as unknown as import('express').Request,
      badRequest,
    )

    expect(paymentService.verifyAccount).not.toHaveBeenCalled()
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountNumber: '',
        qrCode: 'qr-payload',
      }),
      select: { bankCode: true, id: true },
    })
    expect(response).toEqual(expect.objectContaining({
      id: '11111111-2222-3333-4444-555555555555',
      kycRequired: false,
    }))
  })

  it('does not let a QR code bypass account validation for non-PIX quotes', async () => {
    const verifyAccount = jest.fn().mockResolvedValue(true)
    const { controller, prisma } = buildAcceptController({
      paymentService: {
        getLiquidity: jest.fn().mockResolvedValue(1000),
        MAX_TOTAL_AMOUNT_PER_DAY: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 3,
        verifyAccount,
      },
      quote: {
        ...baseQuote,
        paymentMethod: PaymentMethod.BREB,
        targetCurrency: TargetCurrency.COP,
      },
    })

    const response = await controller.acceptTransaction(
      {
        qr_code: 'qr-payload',
        quote_id: requestBody.quote_id,
        user_id: requestBody.user_id,
      },
      { user: partner } as unknown as import('express').Request,
      badRequest,
    )

    expect(verifyAccount).not.toHaveBeenCalled()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(response).toEqual({
      reason: 'We could not verify the account number provided. Please double-check the details and try again.',
    })
  })

  it('requires KYC when the partner needs verification and the user is not approved', async () => {
    const { controller, kycService } = buildAcceptController({
      hasApprovedKyc: false,
      quote: { ...baseQuote, sourceAmount: 30 },
    })
    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, needsKyc: true } } as unknown as import('express').Request,
      badRequest,
    )

    expect(kycService.hasApprovedKyc).toHaveBeenCalled()
    expect(response).toEqual({ id: null, kycRequired: true, payment_context: null, payment_instructions: null, transaction_reference: null })
  })

  it('skips KYC when the user already has an approved submission', async () => {
    const { controller, kycService } = buildAcceptController({
      hasApprovedKyc: true,
      quote: { ...baseQuote, sourceAmount: 30 },
    })
    const response = await controller.acceptTransaction(
      requestBody,
      { user: { ...partner, needsKyc: true } } as unknown as import('express').Request,
      badRequest,
    )

    expect(kycService.hasApprovedKyc).toHaveBeenCalled()
    expect(response).toEqual({
      id: '11111111-2222-3333-4444-555555555555',
      kycRequired: false,
      payment_context: null,
      payment_instructions: null,
      transaction_reference: Buffer.from('11111111222233334444555555555555', 'hex').toString('base64'),
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

    expect(kycService.hasApprovedKyc).not.toHaveBeenCalled()
    expect(response).toEqual({
      id: '11111111-2222-3333-4444-555555555555',
      kycRequired: false,
      payment_context: null,
      payment_instructions: null,
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

  it('returns a retryable error when liquidity retrieval fails', async () => {
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
      reason: 'We could not verify available liquidity for this payment method right now. Please try again in a few moments.',
    })
  })

  it('rejects when reported liquidity is below the requested amount', async () => {
    const { controller } = buildAcceptController({
      paymentService: {
        getLiquidity: jest.fn().mockResolvedValue(10),
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

    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ origin: TransactionOrigin.DIRECT }),
      select: { bankCode: true, id: true },
    })
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalled()
    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(
      QueueName.USER_NOTIFICATION,
      expect.objectContaining({ type: 'transaction.created' }),
      expect.any(String),
      expect.objectContaining({ deliverNow: false }),
    )
    expect(response.transaction_reference).toBeDefined()
  })

  it('persists SEP origin without changing the client request', async () => {
    const { controller, prisma } = buildAcceptController()

    await controller.acceptTransaction(
      requestBody,
      {
        user: { ...partner, authenticationSource: 'SEP_24' },
      } as unknown as import('express').Request,
      badRequest,
    )

    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ origin: TransactionOrigin.SEP_24 }),
      select: { bankCode: true, id: true },
    })
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

  it('rejects when liquidity is below target before any Serializable transaction opens', async () => {
    const { controller, prisma } = buildAcceptController({
      paymentService: {
        getLiquidity: jest.fn().mockResolvedValue(1), // below the 50-target of baseQuote
        MAX_TOTAL_AMOUNT_PER_DAY: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 3,
        verifyAccount: jest.fn().mockResolvedValue(true),
      },
    })

    const response = await controller.acceptTransaction(
      requestBody,
      { user: partner } as unknown as import('express').Request,
      badRequest,
    )

    expect(response).toEqual({
      reason: 'We cannot process this payout because liquidity for this method is below the requested amount. Try a smaller amount or choose another payment method.',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.quote.findUnique).toHaveBeenCalledTimes(1)
  })
})
