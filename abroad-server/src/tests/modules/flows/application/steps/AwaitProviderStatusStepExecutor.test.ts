import { PaymentMethod, TransactionStatus } from '@prisma/client'

import { AwaitProviderStatusStepExecutor } from '../../../../../modules/flows/application/steps/AwaitProviderStatusStepExecutor'
import { TransactionEventDispatcher } from '../../../../../modules/transactions/application/TransactionEventDispatcher'
import { TransactionRepository } from '../../../../../modules/transactions/application/TransactionRepository'
import { createMockLogger } from '../../../../setup/mockFactories'

describe('AwaitProviderStatusStepExecutor', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('persists an asynchronous provider failure reason in the payment transition', async () => {
    const prismaClient = {
      transaction: {
        findUnique: jest.fn(async () => ({
          externalId: 'withdrawal-1',
          id: 'transaction-1',
          onChainId: null,
          partnerUser: { partner: { webhookUrl: 'https://example.com/webhook' }, userId: 'user-1' },
          quote: {
            cryptoCurrency: 'USDC',
            network: 'POLYGON',
            paymentMethod: PaymentMethod.PIX,
            sourceAmount: 20,
          },
        })),
      },
    }
    const updatedTransaction = {
      id: 'transaction-1',
      onChainId: null,
      partnerUser: { partner: { webhookUrl: 'https://example.com/webhook' }, userId: 'user-1' },
      quote: { cryptoCurrency: 'USDC', network: 'POLYGON', sourceAmount: 20 },
      status: TransactionStatus.PAYMENT_FAILED,
    }
    const applyTransition = jest.fn(async () => updatedTransaction)
    jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
    jest.spyOn(TransactionRepository.prototype, 'applyTransition').mockImplementation(applyTransition as never)
    jest.spyOn(TransactionEventDispatcher.prototype, 'notifyPartnerAndUser').mockResolvedValue(undefined)
    jest.spyOn(TransactionEventDispatcher.prototype, 'notifySlack').mockResolvedValue(undefined)

    const executor = new AwaitProviderStatusStepExecutor(
      { getClient: jest.fn(async () => prismaClient) } as never,
      {
        getAdapter: jest.fn(() => ({ mapStatus: jest.fn(() => TransactionStatus.PAYMENT_FAILED) })),
      } as never,
      { refundByOnChainId: jest.fn() } as never,
      createMockLogger(),
      {} as never,
      {} as never,
    )

    const result = await executor.handleSignal({
      config: {},
      runtime: { context: { transactionId: 'transaction-1' }, stepOutputs: new Map() } as never,
      signal: {
        correlationKeys: { externalId: 'withdrawal-1' },
        eventType: 'payment.status.updated',
        payload: {
          failureReason: 'Recipient account is closed',
          provider: 'transfero',
          status: 'FAILED',
        },
        transactionId: 'transaction-1',
      },
      stepOrder: 2,
    })

    expect(applyTransition).toHaveBeenCalledWith(prismaClient, expect.objectContaining({
      context: {
        externalId: 'withdrawal-1',
        provider: 'transfero',
        providerStatus: 'FAILED',
        reason: 'Recipient account is closed',
      },
      name: 'payment_failed',
      transactionId: 'transaction-1',
    }))
    expect(result).toEqual({ error: 'Provider reported payment failure', outcome: 'failed' })
  })
})
