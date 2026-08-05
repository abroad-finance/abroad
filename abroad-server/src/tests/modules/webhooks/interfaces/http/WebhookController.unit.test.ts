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
  failureReason: null | string = null,
): Record<string, unknown> => buildEnvelope(eventType, {
  amount: '12.50',
  createdAt: '2026-07-27T12:30:00.000Z',
  currency: 'BRL',
  endToEndId,
  failureReason,
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

const ONRAMP_TRANSACTION_ID = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb'

const buildPixDepositEnvelope = (
  overrides: {
    endUserId?: null | string
    eventType?: string
    payerTaxId?: null | string
    status?: string
  } = {},
): Record<string, unknown> => buildEnvelope(
  overrides.eventType ?? 'pix.deposit.completed',
  {
    amount: '150.00',
    createdAt: '2026-08-04T12:30:00.000Z',
    currency: 'BRL',
    depositId: 'dep-9001',
    endToEndId: 'E12345678202608041230abcdef01',
    endUserId: overrides.endUserId === undefined ? ONRAMP_TRANSACTION_ID : overrides.endUserId,
    payer: {
      bankCode: '20018183',
      name: 'Joana Silva',
      taxId: overrides.payerTaxId === undefined ? '12345678901' : overrides.payerTaxId,
    },
    status: overrides.status ?? 'COMPLETED',
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
        failureReason: null,
        pixEndToEndId: 'E1234567890123456789012345678901',
        provider: 'transfero',
        status: 'SETTLED',
      },
    )
    expect(setStatus).toHaveBeenCalledWith(200)
  })

  it('publishes a normalized Ultra PIX withdrawal failure reason', async () => {
    const body = buildPixEnvelope(
      'pix.withdrawal.failed',
      'FAILED',
      null,
      '  Recipient account is closed  ',
    )
    const { badRequest, serverError, unauthorized } = responders()

    await expect(controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )).resolves.toMatchObject({ success: true })

    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.PAYMENT_STATUS_UPDATED,
      expect.objectContaining({
        failureReason: 'Recipient account is closed',
        status: 'FAILED',
      }),
    )
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

  it('publishes a completed PIX deposit as an onramp deposit credit', async () => {
    const body = buildPixDepositEnvelope()
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({ message: 'Webhook processed successfully', success: true })
    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.FIAT_DEPOSIT_RECEIVED,
      {
        amount: 150,
        currency: 'BRL',
        endToEndId: 'E12345678202608041230abcdef01',
        payerTaxId: '12345678901',
        provider: 'transfero',
        providerDepositId: 'dep-9001',
        transactionId: ONRAMP_TRANSACTION_ID,
      },
    )
  })

  // A paid deposit has arrived but is not yet credited, so it must not start a
  // crypto delivery. Ultra only guarantees spendable balance on completed.
  it('does not release an onramp delivery on a merely paid deposit', async () => {
    const body = buildPixDepositEnvelope({ eventType: 'pix.deposit.paid', status: 'PAID' })
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body, { 'x-ultra-signature': 'HMAC-SHA256 t=1,sig=signature', 'x-ultra-webhook-event': 'pix.deposit.paid' }),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({ message: 'Webhook processed successfully', success: true })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('rejects a completed deposit event whose body carries a non-completed status', async () => {
    const body = buildPixDepositEnvelope({ status: 'PENDING' })
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({ message: 'Invalid webhook payload', success: false })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  // Attribution is best-effort by contract. An unattributed deposit still
  // credited our balance, so it is acknowledged and left for reconciliation
  // rather than guessed onto a transaction.
  it.each([
    ['a missing endUserId', null],
    ['an endUserId that is not one of our transaction ids', 'not-a-uuid'],
  ])('acknowledges a completed deposit with %s without routing it', async (_label, endUserId) => {
    const body = buildPixDepositEnvelope({ endUserId })
    const { badRequest, serverError, unauthorized } = responders()

    const response = await controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(response).toEqual({ message: 'Webhook processed successfully', success: true })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('carries a null payer tax id through rather than inventing one', async () => {
    const body = buildPixDepositEnvelope({ payerTaxId: null })
    const { badRequest, serverError, unauthorized } = responders()

    await controller.handleTransferoWebhook(
      body,
      buildRequest(body),
      badRequest,
      unauthorized,
      serverError,
    )

    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.FIAT_DEPOSIT_RECEIVED,
      expect.objectContaining({ payerTaxId: null }),
    )
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
