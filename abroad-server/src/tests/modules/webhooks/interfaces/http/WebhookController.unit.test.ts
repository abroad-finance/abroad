import type { Request as ExpressRequest } from 'express'

import { TargetCurrency } from '@prisma/client'

import type { PersonaWebhookService } from '../../../../../modules/webhooks/application/PersonaWebhookService'
import type { WebhookProcessingResult } from '../../../../../modules/webhooks/application/types'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { WebhookController } from '../../../../../modules/webhooks/interfaces/http/WebhookController'
import { QueueName } from '../../../../../platform/messaging/queues'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../../setup/mockFactories'

const setupResponses = () => {
  const badRequest = jest.fn((_code: 400, payload: { message: string, success: false }) => payload)
  const notFound = jest.fn((_code: 404, payload: { message: string, success: false }) => payload)
  const serverError = jest.fn((_code: 500, payload: { message: string, success: false }) => payload)
  return { badRequest, notFound, serverError }
}

describe('WebhookController', () => {
  let queueHandler: MockQueueHandler
  let logger: MockLogger
  let dbProvider: IDatabaseClientProvider
  let controller: WebhookController
  let personaWebhookService: PersonaWebhookService

  beforeEach(() => {
    queueHandler = createMockQueueHandler()
    logger = createMockLogger()
    dbProvider = { getClient: jest.fn(async () => ({} as unknown as import('@prisma/client').PrismaClient)) }
    personaWebhookService = {
      processWebhook: jest.fn(),
    } as unknown as PersonaWebhookService
    controller = new WebhookController(dbProvider, logger, queueHandler, personaWebhookService)
  })

  it('routes Persona webhook responses to the correct TSOA handlers', async () => {
    const responses = setupResponses()
    const request = { headers: {} } as unknown as ExpressRequest

    ;(personaWebhookService.processWebhook as jest.Mock).mockResolvedValueOnce({ payload: { message: 'bad', success: false }, status: 'bad_request' } satisfies WebhookProcessingResult)
    expect(await controller.handlePersonaWebhook({}, request, responses.badRequest, responses.notFound, responses.serverError))
      .toEqual({ message: 'bad', success: false })
    expect(responses.badRequest).toHaveBeenCalledWith(400, { message: 'bad', success: false })

    ;(personaWebhookService.processWebhook as jest.Mock).mockResolvedValueOnce({ payload: { message: 'missing', success: false }, status: 'not_found' } satisfies WebhookProcessingResult)
    await controller.handlePersonaWebhook({}, request, responses.badRequest, responses.notFound, responses.serverError)
    expect(responses.notFound).toHaveBeenCalledWith(404, { message: 'missing', success: false })

    ;(personaWebhookService.processWebhook as jest.Mock).mockResolvedValueOnce({ payload: { message: 'err', success: false }, status: 'error' } satisfies WebhookProcessingResult)
    await controller.handlePersonaWebhook({}, request, responses.badRequest, responses.notFound, responses.serverError)
    expect(responses.serverError).toHaveBeenCalledWith(500, { message: 'err', success: false })

    ;(personaWebhookService.processWebhook as jest.Mock).mockResolvedValueOnce({ payload: { message: 'ok', success: true }, status: 'ok' } satisfies WebhookProcessingResult)
    const success = await controller.handlePersonaWebhook({}, request, responses.badRequest, responses.notFound, responses.serverError)
    expect(success).toEqual({ message: 'ok', success: true })
  })

  it('validates and enqueues Transfero webhooks', async () => {
    const { badRequest, serverError } = setupResponses()
    const request = { headers: { 'x-id': '1' } } as unknown as ExpressRequest

    const invalid = await controller.handleTransferoWebhook({}, request, badRequest, serverError)
    expect(invalid).toEqual({ message: 'Invalid webhook payload', success: false })
    expect(badRequest).toHaveBeenCalled()

    const validPayload = {
      Amount: 10,
      Currency: TargetCurrency.BRL,
      PaymentId: 'pay-1',
      PaymentStatus: 'paid',
    }
    const result = await controller.handleTransferoWebhook(validPayload, request, badRequest, serverError)
    expect(result).toEqual({ message: 'Webhook processed successfully', success: true })
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.PAYMENT_STATUS_UPDATED, expect.objectContaining({
      amount: 10,
      currency: TargetCurrency.BRL,
      externalId: 'pay-1',
      status: 'paid',
    }))
  })

  it('validates and enqueues Transfero balance webhooks', async () => {
    const { badRequest, serverError } = setupResponses()
    const request = { headers: { 'x-id': '1' } } as unknown as ExpressRequest

    const invalid = await controller.handleTransferoBalanceWebhook({}, request, badRequest, serverError)
    expect(invalid).toEqual({ message: 'Invalid webhook payload', success: false })
    expect(badRequest).toHaveBeenCalled()

    const validPayload = {
      accountId: '000',
      amount: 100.0,
      blockchain: 'None',
      createdAt: '2024-10-15T18:17:03.1451537+00:00',
      externalId: 'DCBA4321',
      referenceId: 'TESTE2410151703145154TESTE',
      status: 'DepositCreated',
      taxId: '12345678910',
      taxIdCountry: 'BRA',
    }
    const result = await controller.handleTransferoBalanceWebhook(validPayload, request, badRequest, serverError)
    expect(result).toEqual({ message: 'Webhook processed successfully', success: true })
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.EXCHANGE_BALANCE_UPDATED, { provider: 'transfero' })
  })

  it('logs and returns server errors on Transfero failures', async () => {
    const { badRequest, serverError } = setupResponses()
    const request = { headers: { 'x-id': '1' } } as unknown as ExpressRequest
    const failingPost: MockQueueHandler['postMessage'] = jest.fn(async (queue, message) => {
      void queue
      void message
      throw new Error('queue down')
    })
    const erroringQueue = createMockQueueHandler({ postMessage: failingPost })
    const failing = new WebhookController(dbProvider, logger, erroringQueue, personaWebhookService)

    const result = await failing.handleTransferoWebhook(
      { Currency: TargetCurrency.BRL, PaymentId: 'id', PaymentStatus: 'status' },
      request,
      badRequest,
      serverError,
    )

    expect(serverError).toHaveBeenCalledWith(500, { message: 'Internal server error', success: false })
    expect(result).toEqual({ message: 'Internal server error', success: false })
    expect(logger.error).toHaveBeenCalledWith(
      'Error processing Transfero webhook',
      expect.objectContaining({ error: expect.any(String) }),
    )
  })
})
