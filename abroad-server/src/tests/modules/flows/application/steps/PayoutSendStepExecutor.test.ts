import { FlowStepType, PaymentMethod, TransactionStatus } from '@prisma/client'

import type { PaymentSendResult } from '../../../../../modules/payments/application/contracts/IPaymentService'

import { PayoutSendStepExecutor } from '../../../../../modules/flows/application/steps/PayoutSendStepExecutor'
import { TransactionEventDispatcher } from '../../../../../modules/transactions/application/TransactionEventDispatcher'
import { TransactionRepository } from '../../../../../modules/transactions/application/TransactionRepository'

describe('PayoutSendStepExecutor', () => {
  const baseLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }

  type SetupOptions = {
    applyTransitionResult?: null | object
    initialStatus?: TransactionStatus
    network?: string
    paymentFailureReason?: string
    paymentResult?: PaymentSendResult
  }

  const setup = ({
    applyTransitionResult,
    initialStatus,
    network = 'stellar',
    paymentFailureReason = 'provider_failed',
    paymentResult,
  }: SetupOptions) => {
    const prismaClient = {
      transaction: {
        findUnique: jest.fn(async () => ({
          accountNumber: 'acct-1',
          id: 'tx-1',
          onChainId: 'on-chain-1',
          partnerUser: { partner: { webhookUrl: 'https://example.com/webhook' }, userId: 'user-1' },
          qrCode: null,
          quote: {
            cryptoCurrency: 'USDC',
            network,
            paymentMethod: PaymentMethod.BREB,
            sourceAmount: 20,
            targetAmount: 100,
            targetCurrency: 'COP',
          },
          status: initialStatus,
        })),
      },
    }

    const defaultTransition = {
      id: 'tx-1',
      onChainId: 'on-chain-1',
      partnerUser: { partner: { webhookUrl: 'https://example.com/webhook' }, userId: 'user-1' },
      quote: { cryptoCurrency: 'USDC', network, sourceAmount: 20 },
      status: TransactionStatus.PAYMENT_FAILED,
    }
    const applyTransition = jest.fn(async () => (applyTransitionResult === undefined ? defaultTransition : applyTransitionResult))

    jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
    jest.spyOn(TransactionRepository.prototype, 'recordExternalIdIfMissing').mockResolvedValue(false)
    jest.spyOn(TransactionRepository.prototype, 'persistExternalId').mockResolvedValue(undefined)
    jest.spyOn(TransactionRepository.prototype, 'applyTransition').mockImplementation(applyTransition as never)

    const notifyPartnerAndUser = jest.spyOn(TransactionEventDispatcher.prototype, 'notifyPartnerAndUser').mockResolvedValue(undefined)
    const notifySlack = jest.spyOn(TransactionEventDispatcher.prototype, 'notifySlack').mockResolvedValue(undefined)

    const paymentServiceFactory = {
      getPaymentService: jest.fn(() => ({
        isAsync: true,
        isEnabled: true,
        provider: 'transfero',
        sendPayment: jest.fn(async () => paymentResult ?? ({
          code: 'validation',
          reason: paymentFailureReason,
          success: false,
          transactionId: 'provider-tx-1',
        } as const)),
      })),
      getPaymentServiceForCapability: jest.fn(),
    }

    const refundCoordinator = {
      refundByOnChainId: jest.fn(async () => ({ success: true, transactionId: 'refund-1' })),
    }

    const executor = new PayoutSendStepExecutor(
      { getClient: jest.fn(async () => prismaClient) } as never,
      paymentServiceFactory as never,
      baseLogger,
      {} as never,
      {} as never,
      refundCoordinator as never,
    )

    return { applyTransition, executor, notifyPartnerAndUser, notifySlack, prismaClient, refundCoordinator }
  }

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('applies payment_failed transition for async payout send failures', async () => {
    const { applyTransition, executor, notifyPartnerAndUser, notifySlack, prismaClient, refundCoordinator } = setup({
      paymentFailureReason: 'tax_id_missing',
    })

    expect(executor.stepType).toBe(FlowStepType.PAYOUT_SEND)

    const result = await executor.execute({
      attempt: 1,
      config: {},
      maxAttempts: 3,
      runtime: { context: { transactionId: 'tx-1' }, flowRunId: 'flow-1', stepExecutionId: 'step-1' } as never,
      stepOrder: 1,
    })

    expect(applyTransition).toHaveBeenCalledWith(prismaClient, expect.objectContaining({
      context: expect.objectContaining({
        providerTransactionId: 'provider-tx-1',
        reason: 'tax_id_missing',
        status: 'validation',
      }),
      name: 'payment_failed',
      transactionId: 'tx-1',
    }))
    expect(notifyPartnerAndUser).toHaveBeenCalledTimes(1)
    expect(notifySlack).toHaveBeenCalledWith(expect.anything(), TransactionStatus.PAYMENT_FAILED, expect.anything())
    expect(refundCoordinator.refundByOnChainId).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ error: 'tax_id_missing', outcome: 'failed' })
  })

  it('continues refund flow when retrying PAYMENT_FAILED payout and transition is rejected', async () => {
    const { applyTransition, executor, notifyPartnerAndUser, notifySlack, prismaClient, refundCoordinator } = setup({
      applyTransitionResult: null,
      initialStatus: TransactionStatus.PAYMENT_FAILED,
      network: 'SOLANA',
      paymentFailureReason: 'provider_failed',
    })

    const result = await executor.execute({
      attempt: 3,
      config: {},
      maxAttempts: 3,
      runtime: { context: { transactionId: 'tx-1' }, flowRunId: 'flow-1', stepExecutionId: 'step-1' } as never,
      stepOrder: 1,
    })

    expect(applyTransition).toHaveBeenCalledWith(prismaClient, expect.objectContaining({
      name: 'payment_failed',
      transactionId: 'tx-1',
    }))
    expect(notifyPartnerAndUser).not.toHaveBeenCalled()
    expect(notifySlack).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-1' }), TransactionStatus.PAYMENT_FAILED, expect.anything())
    expect(refundCoordinator.refundByOnChainId).toHaveBeenCalledWith(expect.objectContaining({
      network: 'SOLANA',
      onChainId: 'on-chain-1',
      reason: 'provider_failed',
      transactionId: 'tx-1',
    }))
    expect(result).toEqual({ error: 'provider_failed', outcome: 'failed' })
  })

  it('keeps a retriable payout waiting without terminal transition, notification, or refund', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00.000Z'))
    const { applyTransition, executor, notifyPartnerAndUser, notifySlack, refundCoordinator } = setup({
      paymentResult: {
        code: 'retriable',
        reason: 'Transfero Ultra request failed: RATE_LIMIT_EXCEEDED',
        success: false,
      },
    })

    const result = await executor.execute({
      attempt: 1,
      config: {},
      maxAttempts: 3,
      runtime: { context: { transactionId: 'tx-1' } } as never,
      stepOrder: 1,
    })

    expect(result).toEqual({
      correlation: { transactionId: 'tx-1' },
      outcome: 'waiting',
      output: {
        provider: 'transfero',
        retry: {
          attempt: 1,
          maxAttempts: 3,
          nextAttemptAt: '2026-07-31T12:01:05.000Z',
          reason: 'provider_retriable',
        },
      },
      retryAt: new Date('2026-07-31T12:01:05.000Z'),
    })
    expect(applyTransition).not.toHaveBeenCalled()
    expect(notifyPartnerAndUser).not.toHaveBeenCalled()
    expect(notifySlack).not.toHaveBeenCalled()
    expect(refundCoordinator.refundByOnChainId).not.toHaveBeenCalled()
  })

  it('doubles the retry delay for the second bounded attempt', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00.000Z'))
    const { executor } = setup({
      paymentResult: { code: 'retriable', reason: 'rate_limited', success: false },
    })

    await expect(executor.execute({
      attempt: 2,
      config: {},
      maxAttempts: 3,
      runtime: { context: { transactionId: 'tx-1' } } as never,
      stepOrder: 1,
    })).resolves.toEqual(expect.objectContaining({
      outcome: 'waiting',
      retryAt: new Date('2026-07-31T12:02:10.000Z'),
    }))
  })

  it('terminalizes and refunds exactly once when retriable attempts are exhausted', async () => {
    const { applyTransition, executor, notifyPartnerAndUser, notifySlack, refundCoordinator } = setup({
      paymentResult: {
        code: 'retriable',
        reason: 'Transfero Ultra request failed: RATE_LIMIT_EXCEEDED',
        success: false,
      },
    })

    const result = await executor.execute({
      attempt: 3,
      config: {},
      maxAttempts: 3,
      runtime: { context: { transactionId: 'tx-1' } } as never,
      stepOrder: 1,
    })

    expect(applyTransition).toHaveBeenCalledTimes(1)
    expect(notifyPartnerAndUser).toHaveBeenCalledTimes(1)
    expect(notifySlack).toHaveBeenCalledTimes(1)
    expect(refundCoordinator.refundByOnChainId).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      error: 'Transfero Ultra request failed: RATE_LIMIT_EXCEEDED',
      outcome: 'failed',
    })
  })

  it('allows a retried async payout to recover through the existing success path', async () => {
    const { applyTransition, executor, notifyPartnerAndUser, refundCoordinator } = setup({
      paymentResult: { success: true, transactionId: 'provider-success' },
    })

    await expect(executor.execute({
      attempt: 2,
      config: {},
      maxAttempts: 3,
      runtime: { context: { transactionId: 'tx-1' } } as never,
      stepOrder: 1,
    })).resolves.toEqual({
      correlation: { externalId: 'provider-success' },
      outcome: 'succeeded',
      output: { externalId: 'provider-success', provider: 'transfero' },
    })
    expect(applyTransition).not.toHaveBeenCalled()
    expect(notifyPartnerAndUser).not.toHaveBeenCalled()
    expect(refundCoordinator.refundByOnChainId).not.toHaveBeenCalled()
  })
})
