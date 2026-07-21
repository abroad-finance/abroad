import 'reflect-metadata'
import { TargetCurrency } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { WebhookController } from '../../../../../modules/webhooks/interfaces/http/WebhookController'
import { QueueName } from '../../../../../platform/messaging/queues'
import {
  createMockLogger,
  createMockQueueHandler,
  createResponder,
  MockLogger,
  MockQueueHandler,
} from '../../../../setup/mockFactories'

describe('WebhookController webhooks', () => {
  let dbProvider: IDatabaseClientProvider
  let queueHandler: MockQueueHandler
  let logger: MockLogger

  const buildRequest = (rawBody?: string) => (
    {
      headers: { 'x-test': 'true' },
      rawBody,
    } as unknown as import('express').Request & { rawBody?: string }
  )

  beforeEach(() => {
    dbProvider = {
      getClient: jest.fn(async () => ({} as unknown as import('@prisma/client').PrismaClient)),
    } as unknown as IDatabaseClientProvider
    queueHandler = createMockQueueHandler()
    logger = createMockLogger()
  })

  describe('Transfero webhook', () => {
    it('rejects invalid payloads', async () => {
      const controller = new WebhookController(dbProvider, logger, queueHandler)
      const badRequest = createResponder<400, { message: string, success: false }>()

      const response = await controller.handleTransferoWebhook(
        { Currency: TargetCurrency.BRL },
        buildRequest(),
        badRequest,
        createResponder<500, { message: string, success: false }>(),
      )

      expect(response).toEqual({ message: 'Invalid webhook payload', success: false })
      expect(badRequest).toHaveBeenCalledWith(400, { message: 'Invalid webhook payload', success: false })
      expect(queueHandler.postMessage).not.toHaveBeenCalled()
    })

    it('publishes normalized payment status updates', async () => {
      const controller = new WebhookController(dbProvider, logger, queueHandler)
      const serverError = createResponder<500, { message: string, success: false }>()
      const setStatus = jest.spyOn(controller, 'setStatus')

      const response = await controller.handleTransferoWebhook(
        {
          Amount: 12.5,
          Currency: TargetCurrency.BRL,
          PaymentId: 'payment-1',
          PaymentStatus: 'COMPLETED',
        },
        buildRequest(),
        createResponder<400, { message: string, success: false }>(),
        serverError,
      )

      expect(response).toEqual({ message: 'Webhook processed successfully', success: true })
      expect(queueHandler.postMessage).toHaveBeenCalledWith(
        QueueName.PAYMENT_STATUS_UPDATED,
        {
          amount: 12.5,
          currency: TargetCurrency.BRL,
          externalId: 'payment-1',
          provider: 'transfero',
          status: 'COMPLETED',
        },
      )
      expect(setStatus).toHaveBeenCalledWith(200)
      expect(serverError).not.toHaveBeenCalled()
    })
  })
})
