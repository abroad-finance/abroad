import 'reflect-metadata'
import { TargetCurrency } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { FlowOrchestrator } from '../../../../../modules/flows/application/FlowOrchestrator'
import { PaymentStatusUpdatedController } from '../../../../../modules/payments/interfaces/queue/PaymentStatusUpdatedController'
import { QueueName } from '../../../../../platform/messaging/queues'
import { PaymentStatusUpdatedMessage } from '../../../../../platform/messaging/queueSchema'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../../setup/mockFactories'

describe('PaymentStatusUpdatedController', () => {
  let controller: PaymentStatusUpdatedController
  let dbProvider: IDatabaseClientProvider
  let logger: MockLogger
  let queueHandler: MockQueueHandler
  let orchestrator: jest.Mocked<Pick<FlowOrchestrator, 'handleSignal'>>

  beforeEach(() => {
    logger = createMockLogger()
    queueHandler = createMockQueueHandler()
    orchestrator = {
      handleSignal: jest.fn(),
    }
    const prisma = {
      transaction: {
        findUnique: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    }
    dbProvider = {
      getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider

    controller = new PaymentStatusUpdatedController(
      orchestrator as unknown as FlowOrchestrator,
      queueHandler,
      logger,
      dbProvider,
    )
  })

  it('registers the consumer safely', () => {
    controller.registerConsumers()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.PAYMENT_STATUS_UPDATED,
      expect.any(Function),
    )
    expect(logger.info).toHaveBeenCalled()
  })

  it('rejects invalid messages and avoids workflow invocation', async () => {
    const handler = controller as unknown as { onPaymentStatusUpdated: (msg: unknown) => Promise<void> }

    await expect(handler.onPaymentStatusUpdated({ status: '' })).rejects.toThrow(/Invalid payment status update message/)

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
    expect(orchestrator.handleSignal).not.toHaveBeenCalled()
  })

  it('delegates valid messages to the flow orchestrator', async () => {
    const handler = controller as unknown as { onPaymentStatusUpdated: (msg: PaymentStatusUpdatedMessage) => Promise<void> }
    const message: PaymentStatusUpdatedMessage = {
      amount: 100,
      currency: TargetCurrency.BRL,
      externalId: 'ext-1',
      failureReason: 'Recipient account is closed',
      pixEndToEndId: 'E1234567890123456789012345678901',
      provider: 'transfero',
      status: 'SETTLED',
    }
    const prisma = await dbProvider.getClient()
    const transaction = (prisma as unknown as {
      transaction: { findUnique: jest.Mock, updateMany: jest.Mock }
    }).transaction
    transaction.findUnique = jest.fn().mockResolvedValue({ id: 'tx-1', pixEndToEndId: null })

    await handler.onPaymentStatusUpdated(message)

    expect(orchestrator.handleSignal).toHaveBeenCalledWith({
      correlationKeys: { externalId: message.externalId },
      eventType: 'payment.status.updated',
      payload: {
        amount: message.amount,
        currency: message.currency,
        externalId: message.externalId,
        failureReason: message.failureReason,
        provider: message.provider,
        status: message.status,
      },
      transactionId: 'tx-1',
    })
    expect(transaction.updateMany).toHaveBeenCalledWith({
      data: { pixEndToEndId: message.pixEndToEndId },
      where: { id: 'tx-1', pixEndToEndId: null },
    })
  })

  it('keeps the first PIX end-to-end ID when a conflicting webhook arrives', async () => {
    const handler = controller as unknown as { onPaymentStatusUpdated: (msg: PaymentStatusUpdatedMessage) => Promise<void> }
    const prisma = await dbProvider.getClient()
    const transaction = (prisma as unknown as {
      transaction: { findUnique: jest.Mock, updateMany: jest.Mock }
    }).transaction
    transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      pixEndToEndId: 'E1111111111111111111111111111111',
    })

    await handler.onPaymentStatusUpdated({
      currency: TargetCurrency.BRL,
      externalId: 'ext-1',
      pixEndToEndId: 'E2222222222222222222222222222222',
      provider: 'transfero',
      status: 'SETTLED',
    })

    expect(transaction.updateMany).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring conflicting PIX end-to-end ID'),
      { transactionId: 'tx-1' },
    )
    expect(orchestrator.handleSignal).toHaveBeenCalled()
  })

  it('logs when the orchestrator throws', async () => {
    const handler = controller as unknown as { onPaymentStatusUpdated: (msg: PaymentStatusUpdatedMessage) => Promise<void> }
    orchestrator.handleSignal.mockRejectedValueOnce(new Error('boom'))
    const prisma = await dbProvider.getClient()
    ;(prisma as unknown as { transaction: { findUnique: jest.Mock } }).transaction.findUnique
      = jest.fn().mockResolvedValue({ id: 'tx-2', pixEndToEndId: null })

    await expect(handler.onPaymentStatusUpdated({
      amount: 100,
      currency: TargetCurrency.BRL,
      externalId: 'ext-2',
      provider: 'transfero',
      status: 'failed',
    })).rejects.toThrow('boom')

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating flow'),
      expect.any(Error),
    )
  })
})
