import 'reflect-metadata'

import { createScopedLogger } from '../../../../core/logging/scopedLogger'
import { TransactionRepository, RefundReservation } from '../../../../modules/transactions/application/TransactionRepository'
import { TransactionWorkflow } from '../../../../modules/transactions/application/TransactionWorkflow'
import { createMockLogger } from '../../../setup/mockFactories'

const buildWorkflow = (reservation: RefundReservation, baseLogger = createMockLogger()) => {
  const workflow = new TransactionWorkflow(
    { getClient: jest.fn() } as unknown as import('../../../../platform/persistence/IDatabaseClientProvider').IDatabaseClientProvider,
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
    recordRefundOutcome: jest.fn(),
    reserveRefund: jest.fn(async () => reservation),
  } as unknown as TransactionRepository

  (workflow as unknown as { repository: TransactionRepository }).repository = repository

  return { baseLogger, repository, workflow }
}

describe('TransactionWorkflow refund guard', () => {
  it('dispatches refund once when reservation succeeds', async () => {
    const { baseLogger, repository, workflow } = buildWorkflow({ attempts: 1, outcome: 'reserved' })
    const refund = jest.fn(async () => ({ success: true, transactionId: 'refund-1' }))
    const scopedLogger = createScopedLogger(baseLogger, { scope: 'refund-test' })

    await (workflow as unknown as { attemptRefund: TransactionWorkflow['attemptRefund'] }).attemptRefund(
      {} as never,
      { logger: scopedLogger, reason: 'unit-test', refund, transactionId: 'txn-1', trigger: 'test' },
    )

    expect(repository.reserveRefund).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ idempotencyKey: 'refund|txn-1', transactionId: 'txn-1' }),
    )
    expect(refund).toHaveBeenCalledTimes(1)
    expect(repository.recordRefundOutcome).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        idempotencyKey: 'refund|txn-1',
        refundResult: { success: true, transactionId: 'refund-1' },
        transactionId: 'txn-1',
      }),
    )
  })

  it('skips refund when one is already in flight', async () => {
    const { baseLogger, repository, workflow } = buildWorkflow({ attempts: 2, outcome: 'in_flight' })
    const refund = jest.fn()
    const scopedLogger = createScopedLogger(baseLogger, { scope: 'refund-test' })

    await (workflow as unknown as { attemptRefund: TransactionWorkflow['attemptRefund'] }).attemptRefund(
      {} as never,
      { logger: scopedLogger, reason: 'unit-test', refund, transactionId: 'txn-2', trigger: 'test' },
    )

    expect(refund).not.toHaveBeenCalled()
    expect(repository.recordRefundOutcome).not.toHaveBeenCalled()
    expect(baseLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Skipping refund; already in flight'),
      expect.objectContaining({ transactionId: 'txn-2' }),
    )
  })

  it('records failed refunds with the reason', async () => {
    const { baseLogger, repository, workflow } = buildWorkflow({ attempts: 1, outcome: 'reserved' })
    const refund = jest.fn(async () => ({ reason: 'insufficient-funds', success: false }))
    const scopedLogger = createScopedLogger(baseLogger, { scope: 'refund-test' })

    await (workflow as unknown as { attemptRefund: TransactionWorkflow['attemptRefund'] }).attemptRefund(
      {} as never,
      { logger: scopedLogger, reason: 'unit-test', refund, transactionId: 'txn-3', trigger: 'test' },
    )

    expect(refund).toHaveBeenCalledTimes(1)
    expect(repository.recordRefundOutcome).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        refundResult: { reason: 'insufficient-funds', success: false },
        transactionId: 'txn-3',
      }),
    )
    expect(baseLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Refund attempt failed'),
      expect.objectContaining({ reason: 'insufficient-funds', transactionId: 'txn-3' }),
    )
  })
})
