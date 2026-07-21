import type { Request as ExpressRequest } from 'express'

import { TargetCurrency } from '@prisma/client'

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

  beforeEach(() => {
    queueHandler = createMockQueueHandler()
    logger = createMockLogger()
    dbProvider = { getClient: jest.fn(async () => ({} as unknown as import('@prisma/client').PrismaClient)) }
    controller = new WebhookController(dbProvider, logger, queueHandler)
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

  it('enqueues Transfero balance webhooks that omit externalId (real deposit payload)', async () => {
    const { badRequest, serverError } = setupResponses()
    const request = { headers: { 'x-id': '1' } } as unknown as ExpressRequest

    // Real Transfero deposit/credit callbacks do not include an externalId field.
    const depositPayload = {
      accountId: '000',
      amount: 100.0,
      blockchain: 'None',
      createdAt: '2024-10-15T18:17:03.1451537+00:00',
      referenceId: 'TESTE2410151703145154TESTE',
      status: 'DepositCreated',
      taxId: '12345678910',
      taxIdCountry: 'BRA',
    }
    const result = await controller.handleTransferoBalanceWebhook(depositPayload, request, badRequest, serverError)
    expect(result).toEqual({ message: 'Webhook processed successfully', success: true })
    expect(badRequest).not.toHaveBeenCalled()
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.EXCHANGE_BALANCE_UPDATED, { provider: 'transfero' })
  })

  it('enqueues Transfero credit-transaction webhooks (amount object, no top-level tax fields)', async () => {
    const { badRequest, serverError } = setupResponses()
    const request = { headers: { 'x-id': '1' } } as unknown as ExpressRequest

    // Real Transfero credit-transaction callback (e.g. an on-chain crypto deposit):
    // amount is a nested object and the deposit-order-only fields
    // (createdAt/referenceId/status/taxId/taxIdCountry) are absent.
    const creditPayload = {
      amount: { amount: 0.2, currency: 'USDC' },
      blockchain: 'SOLANA',
      transactionId: 'cFzpEo3JsWy88ge7WnSPTMxjf1sdZX4DLBUyg2Rdx4mWjVdEMXntNYnnY6HjpdE7gVEoU98e4xV2PmN2zccadgi',
      type: 'Credit',
    }
    const result = await controller.handleTransferoBalanceWebhook(creditPayload, request, badRequest, serverError)
    expect(result).toEqual({ message: 'Webhook processed successfully', success: true })
    expect(badRequest).not.toHaveBeenCalled()
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
    const failing = new WebhookController(dbProvider, logger, erroringQueue)

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
