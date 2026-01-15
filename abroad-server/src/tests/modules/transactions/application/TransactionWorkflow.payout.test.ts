import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import { TransactionWorkflow } from '../../../../modules/transactions/application/TransactionWorkflow'
import { ReceivedCryptoTransactionMessage } from '../../../../platform/messaging/queueSchema'
import { createMockLogger } from '../../../setup/mockFactories'

const baseMessage: ReceivedCryptoTransactionMessage = {
  addressFrom: 'sender-wallet',
  amount: 100,
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  onChainId: 'on-chain-id',
  transactionId: 'txn-123',
}

const buildTransaction = () => ({
  accountNumber: 'account-1',
  id: baseMessage.transactionId,
  partnerUser: { partner: { webhookUrl: 'https://example.com' }, userId: 'user-1' },
  quote: {
    cryptoCurrency: CryptoCurrency.USDC,
    network: BlockchainNetwork.STELLAR,
    paymentMethod: PaymentMethod.PIX,
    sourceAmount: baseMessage.amount,
    targetAmount: 500_000,
    targetCurrency: TargetCurrency.BRL,
  },
  status: TransactionStatus.PROCESSING_PAYMENT,
}) as const

const buildWorkflow = (overrides?: {
  recordPayoutResult?: jest.Mock
  reservePayout?: jest.Mock
}) => {
  const baseLogger = createMockLogger()
  const workflow = new TransactionWorkflow(
    { getClient: jest.fn(async () => ({})) } as unknown as import('../../../../platform/persistence/IDatabaseClientProvider').IDatabaseClientProvider,
    { getPaymentService: jest.fn(), getPaymentServiceForCapability: jest.fn() } as unknown as import('../../../../modules/payments/application/contracts/IPaymentServiceFactory').IPaymentServiceFactory,
    { getAdapter: jest.fn() } as unknown as import('../../../../modules/payments/application/PayoutStatusAdapterRegistry').PayoutStatusAdapterRegistry,
    { getWalletHandlerForCapability: jest.fn() } as unknown as import('../../../../modules/payments/application/contracts/IWalletHandlerFactory').IWalletHandlerFactory,
    { getExchangeProviderForCapability: jest.fn() } as unknown as import('../../../../modules/treasury/application/contracts/IExchangeProviderFactory').IExchangeProviderFactory,
    { notifyWebhook: jest.fn() } as unknown as import('../../../../platform/notifications/IWebhookNotifier').IWebhookNotifier,
    {
      enqueueQueue: jest.fn(),
      enqueueSlack: jest.fn(),
      enqueueWebhook: jest.fn(),
    } as unknown as import('../../../../platform/outbox/OutboxDispatcher').OutboxDispatcher,
    baseLogger,
  )

  const repository = {
    applyDepositReceived: jest.fn(async () => ({ transaction: buildTransaction(), transitionApplied: true })),
    applyTransition: jest.fn(),
    findRefundState: jest.fn(),
    getClient: jest.fn(async () => ({})),
    recordPayoutResult: overrides?.recordPayoutResult ?? jest.fn(),
    reservePayout: overrides?.reservePayout ?? jest.fn(async () => ({ attempts: 1, outcome: 'reserved' })),
  } as unknown as import('../../../../modules/transactions/application/TransactionRepository').TransactionRepository

  const dispatcher = {
    notifyPartnerAndUser: jest.fn(async () => undefined),
    notifySlack: jest.fn(),
    publishPaymentSent: jest.fn(),
  } as unknown as import('../../../../modules/transactions/application/TransactionEventDispatcher').TransactionEventDispatcher

  ;(workflow as unknown as { repository: typeof repository }).repository = repository
  ;(workflow as unknown as { dispatcher: typeof dispatcher }).dispatcher = dispatcher

  return { dispatcher, repository, workflow }
}

describe('TransactionWorkflow payout idempotency', () => {
  it('skips payout when a dispatch is already in flight', async () => {
    const reservePayout = jest.fn(async () => ({ attempts: 1, outcome: 'in_flight' }))
    const recordPayoutResult = jest.fn()
    const { repository, workflow } = buildWorkflow({ recordPayoutResult, reservePayout })
    const processPayout = jest.fn()
    ;(workflow as unknown as { processPayout: TransactionWorkflow['processPayout'] }).processPayout = processPayout

    await workflow.handleIncomingDeposit(baseMessage)

    expect(repository.applyDepositReceived).toHaveBeenCalled()
    expect(reservePayout).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: `payout_dispatch|${baseMessage.transactionId}`,
      transactionId: baseMessage.transactionId,
    }))
    expect(processPayout).not.toHaveBeenCalled()
    expect(recordPayoutResult).not.toHaveBeenCalled()
  })

  it('records payout completion when processing proceeds', async () => {
    const recordPayoutResult = jest.fn()
    const { workflow } = buildWorkflow({ recordPayoutResult })
    const processPayout = jest.fn(async () => undefined)
    ;(workflow as unknown as { processPayout: TransactionWorkflow['processPayout'] }).processPayout = processPayout

    await workflow.handleIncomingDeposit(baseMessage)

    expect(processPayout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: baseMessage.transactionId }),
      baseMessage,
      expect.anything(),
    )
    expect(recordPayoutResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `payout_dispatch|${baseMessage.transactionId}`,
        outcome: 'completed',
        transactionId: baseMessage.transactionId,
      }),
    )
  })
})
