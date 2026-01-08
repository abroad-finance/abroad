import 'reflect-metadata'

import { TargetCurrency } from '@prisma/client'

import { PaymentStatusUpdatedController } from '../../../../../modules/payments/interfaces/queue/PaymentStatusUpdatedController'
import { QueueName } from '../../../../../platform/messaging/queues'
import { PaymentStatusUpdatedMessage } from '../../../../../platform/messaging/queueSchema'
import { TransactionWorkflow } from '../../../../../modules/transactions/application/TransactionWorkflow'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../../setup/mockFactories'

describe('PaymentStatusUpdatedController', () => {
  let controller: PaymentStatusUpdatedController
  let logger: MockLogger
  let queueHandler: MockQueueHandler
  let workflow: jest.Mocked<TransactionWorkflow>

  beforeEach(() => {
    logger = createMockLogger()
    queueHandler = createMockQueueHandler()
    workflow = {
      handleProviderStatusUpdate: jest.fn(),
    } as unknown as jest.Mocked<TransactionWorkflow>

    controller = new PaymentStatusUpdatedController(
      workflow,
      queueHandler,
      logger,
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

    await handler.onPaymentStatusUpdated({ status: '' })

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
    expect(workflow.handleProviderStatusUpdate).not.toHaveBeenCalled()
  })

  it('delegates valid messages to the workflow', async () => {
    const handler = controller as unknown as { onPaymentStatusUpdated: (msg: PaymentStatusUpdatedMessage) => Promise<void> }
    const message: PaymentStatusUpdatedMessage = {
      amount: 100,
      currency: TargetCurrency.BRL,
      externalId: 'ext-1',
      provider: 'transfero',
      status: 'processed',
    }

    await handler.onPaymentStatusUpdated(message)

    expect(workflow.handleProviderStatusUpdate).toHaveBeenCalledWith(message)
  })

  it('logs when the workflow throws', async () => {
    const handler = controller as unknown as { onPaymentStatusUpdated: (msg: PaymentStatusUpdatedMessage) => Promise<void> }
    workflow.handleProviderStatusUpdate.mockRejectedValueOnce(new Error('boom'))

    await handler.onPaymentStatusUpdated({
      amount: 100,
      currency: TargetCurrency.BRL,
      externalId: 'ext-2',
      provider: 'transfero',
      status: 'failed',
    })

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating transaction'),
      expect.any(Error),
    )
  })
})
