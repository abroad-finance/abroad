import 'reflect-metadata'

import type { RawBodyRequest } from '../../../../../modules/webhooks/interfaces/http/WebhookController'

import { TransferoUltraWebhookSignatureError, TransferoUltraWebhookVerifier } from '../../../../../modules/transfero/infrastructure/TransferoUltraWebhookVerifier'
import { WebhookController } from '../../../../../modules/webhooks/interfaces/http/WebhookController'
import { QueueName } from '../../../../../platform/messaging/queues'
import {
  createMockLogger,
  createMockQueueHandler,
  createResponder,
  MockLogger,
  MockQueueHandler,
} from '../../../../setup/mockFactories'

type HeaderMap = Readonly<Record<string, string | undefined>>

const EVENT_ID = '11111111-2222-4333-8444-555555555555'
const WITHDRAWAL_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const buildRequest = (
  body: Record<string, unknown>,
  headers: HeaderMap = {
    'x-ultra-signature': 'HMAC-SHA256 t=1,sig=signature',
  },
  includeRawBody = true,
): RawBodyRequest => ({
  header: jest.fn((name: string) => headers[name.toLowerCase()]),
  rawBody: includeRawBody
    ? Buffer.from(JSON.stringify(body))
    : undefined,
} as unknown as RawBodyRequest)

const buildEnvelope = (
  eventType: string,
  data: Record<string, unknown>,
): Record<string, unknown> => ({
  attempt: 1,
  data,
  deliveredAt: '2026-07-27T12:34:57.000Z',
  eventId: EVENT_ID,
  eventType,
  occurredAt: '2026-07-27T12:34:56.000Z',
  partnerId: 'partner-1',
})

const buildPixEnvelope = (
  eventType = 'pix.withdrawal.settled',
  status = 'SETTLED',
  endToEndId: null | string = null,
): Record<string, unknown> => buildEnvelope(eventType, {
  amount: '12.50',
  createdAt: '2026-07-27T12:30:00.000Z',
  currency: 'BRL',
  endToEndId,
  failureReason: null,
  pixKey: '***@example.com',
  pixKeyType: 'EMAIL',
  pspTransactionId: null,
  returnedAt: null,
  settledAt: '2026-07-27T12:34:56.000Z',
  status,
  tags: [],
  withdrawalId: WITHDRAWAL_ID,
})

const buildCryptoConfirmedEnvelope = (): Record<string, unknown> => buildEnvelope(
  'crypto.deposit.confirmed',
  {
    amount: '25.000000',
    asset: 'USDC',
    blockchain: 'POLYGON',
    confirmedAt: '2026-07-27T12:34:56.000Z',
    fromAddress: '0xsource',
    status: 'CONFIRMED',
    transactionId: 'deposit-1',
    txHash: '0xhash',
  },
)

const buildCryptoCreditFailedEnvelope = (): Record<string, unknown> => buildEnvelope(
  'crypto.deposit.credit_failed',
  {
    amount: '25.000000',
    asset: 'USDC',
    blockchain: 'POLYGON',
    failureReason: 'Compliance review failed',
    transactionId: 'deposit-2',
    txHash: '0xfailed',
  },
)

describe('WebhookController Transfero Ultra webhook', () => {
  let controller: WebhookController
  let logger: MockLogger
  let queueHandler: MockQueueHandler
  let verify: jest.MockedFunction<TransferoUltraWebhookVerifier['verify']>

  beforeEach(() => {
    logger = createMockLogger()
    queueHandler = createMockQueueHandler()
    verify = jest.fn(async (
      params: Parameters<TransferoUltraWebhookVerifier['verify']>[0],
    ) => {
      void params
    })
    controller = new WebhookController(
      logger,
      queueHandler,
      { verify } as unknown as TransferoUltraWebhookVerifier,
    )
  })

  const responders = () => ({
    badRequest: createResponder<400, { message: string, success: false }>(),
    serverError: createResponder<500, { message: string, success: false }>(),
    unauthorized: createResponder<401, { message: string, success: false }>(),
  })

  it('rejects requests without captured raw bytes before parsing JSON', async () => {
    const body = buildPixEnvelope()
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body, undefined, false),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({
      message: 'Invalid webhook signature',
      success: false,
    })
    expect(unauthorized).toHaveBeenCalledWith(401, {
      message: 'Invalid webhook signature',
      success: false,
    })
    expect(verify).not.toHaveBeenCalled()
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('rejects an invalid Ultra signature before trusting the payload', async () => {
    const body = buildPixEnvelope()
    verify.mockRejectedValue(new TransferoUltraWebhookSignatureError('Invalid signature'))
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({
      message: 'Invalid webhook signature',
      success: false,
    })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('returns bad request for a signed envelope with invalid event data', async () => {
    const body = buildEnvelope('pix.withdrawal.settled', {
      status: 'SETTLED',
    })
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({
      message: 'Invalid webhook payload',
      success: false,
    })
    expect(badRequest).toHaveBeenCalledWith(400, {
      message: 'Invalid webhook payload',
      success: false,
    })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('publishes an exact Ultra PIX withdrawal status update', async () => {
    const body = buildPixEnvelope(
      'pix.withdrawal.settled',
      'SETTLED',
      'E1234567890123456789012345678901',
    )
    const { badRequest, serverError, unauthorized } = responders()
    const setStatus = jest.spyOn(controller, 'setStatus')

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body, {
        'x-ultra-signature': 'signature',
        'x-ultra-webhook-event': 'pix.withdrawal.settled',
      }),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({
      message: 'Webhook processed successfully',
      success: true,
    })
    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.PAYMENT_STATUS_UPDATED,
      {
        amount: 12.5,
        currency: 'BRL',
        externalId: WITHDRAWAL_ID,
        pixEndToEndId: 'E1234567890123456789012345678901',
        provider: 'transfero',
        status: 'SETTLED',
      },
    )
    expect(setStatus).toHaveBeenCalledWith(200)
  })

  it('accepts a review-held status on the submitted event', async () => {
    const body = buildPixEnvelope(
      'pix.withdrawal.submitted',
      'HELD_FOR_REVIEW',
    )
    const { badRequest, serverError, unauthorized } = responders()

    await expect(controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )).resolves.toEqual({
      message: 'Webhook processed successfully',
      success: true,
    })

    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.PAYMENT_STATUS_UPDATED,
      expect.objectContaining({ status: 'HELD_FOR_REVIEW' }),
    )
  })

  it('accepts Ultra cancellation and rejection statuses on the failed event', async () => {
    const { badRequest, serverError, unauthorized } = responders()

    for (const status of ['CANCELLED', 'REJECTED']) {
      const body = buildPixEnvelope('pix.withdrawal.failed', status)
      await expect(controller.handleTransferoWebhook(
        body,
        buildRequest(body),
        badRequest,
        unauthorized,
        serverError,
      )).resolves.toMatchObject({ success: true })
    }

    expect(queueHandler.postMessage).toHaveBeenCalledTimes(2)
    expect(queueHandler.postMessage).toHaveBeenNthCalledWith(
      1,
      QueueName.PAYMENT_STATUS_UPDATED,
      expect.objectContaining({ status: 'CANCELLED' }),
    )
    expect(queueHandler.postMessage).toHaveBeenNthCalledWith(
      2,
      QueueName.PAYMENT_STATUS_UPDATED,
      expect.objectContaining({ status: 'REJECTED' }),
    )
  })

  it('publishes confirmed Polygon deposits as exchange balance updates', async () => {
    const body = buildCryptoConfirmedEnvelope()
    const { badRequest, serverError, unauthorized } = responders()

    await expect(controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )).resolves.toMatchObject({ success: true })

    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.EXCHANGE_BALANCE_UPDATED,
      { provider: 'transfero' },
    )
  })

  it('records credit failures without treating them as usable balance', async () => {
    const body = buildCryptoCreditFailedEnvelope()
    const { badRequest, serverError, unauthorized } = responders()

    await expect(controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )).resolves.toMatchObject({ success: true })

    expect(queueHandler.postMessage).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      'Transfero Ultra crypto deposit credit failed',
      expect.objectContaining({
        eventId: EVENT_ID,
        transactionId: 'deposit-2',
      }),
    )
  })

  it('acknowledges unknown signed events without dispatching side effects', async () => {
    const body = buildEnvelope('account.updated', { version: 1 })
    const { badRequest, serverError, unauthorized } = responders()

    await expect(controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )).resolves.toMatchObject({ success: true })

    expect(queueHandler.postMessage).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      'Ignored unconfigured Transfero Ultra webhook event',
      {
        eventId: EVENT_ID,
        eventType: 'account.updated',
      },
    )
  })

  it('rejects a header event type that disagrees with the signed body', async () => {
    const body = buildPixEnvelope()
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body, {
        'x-ultra-signature': 'signature',
        'x-ultra-webhook-event': 'pix.withdrawal.failed',
      }),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toMatchObject({ success: false })
    expect(badRequest).toHaveBeenCalledWith(400, {
      message: 'Invalid webhook payload',
      success: false,
    })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('returns server error when queue dispatch fails after verification', async () => {
    const body = buildPixEnvelope()
    queueHandler.postMessage.mockRejectedValue(new Error('queue down'))
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({
      message: 'Internal server error',
      success: false,
    })
    expect(serverError).toHaveBeenCalledWith(500, {
      message: 'Internal server error',
      success: false,
    })
  })
})
