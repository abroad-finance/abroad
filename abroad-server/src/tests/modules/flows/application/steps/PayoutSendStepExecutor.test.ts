import { FlowStepType, PaymentMethod, TransactionStatus } from '@prisma/client'

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
    paymentFailureReason: string
  }

  const setup = ({
    applyTransitionResult,
    initialStatus,
    network = 'stellar',
    paymentFailureReason,
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
        sendPayment: jest.fn(async () => ({
          code: 'validation',
          reason: paymentFailureReason,
          success: false,
          transactionId: 'provider-tx-1',
        })),
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
      refundCoordinator as never,
    )

    return { applyTransition, executor, notifyPartnerAndUser, notifySlack, prismaClient, refundCoordinator }
  }

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('applies payment_failed transition for async payout send failures', async () => {
    const { applyTransition, executor, notifyPartnerAndUser, notifySlack, prismaClient, refundCoordinator } = setup({
      paymentFailureReason: 'tax_id_missing',
    })

    expect(executor.stepType).toBe(FlowStepType.PAYOUT_SEND)

    const result = await executor.execute({
      config: {},
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
      config: {},
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
})
