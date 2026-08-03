import 'reflect-metadata'

import type { Request as ExpressRequest } from 'express'
import type { TsoaResponse } from 'tsoa'

import { ILogger } from '../../../../../core/logging/types'
import { PartnerPortalEmailDeliveryLifecycleService } from '../../../../../modules/partners/application/PartnerPortalEmailDeliveryLifecycleService'
import { ResendWebhookSignatureError, ResendWebhookVerifier } from '../../../../../modules/partners/infrastructure/ResendWebhookVerifier'
import { ResendWebhookController } from '../../../../../modules/partners/interfaces/http/ResendWebhookController'

const payload = {
  created_at: '2026-08-03T15:00:00.000Z',
  data: {
    email_id: 'resend-message-1',
    to: ['admin@atlas.example'],
  },
  type: 'email.delivered',
}

const responder = <TStatus extends 400 | 401 | 500>(): TsoaResponse<
  TStatus,
  { message: string, success: false }
> => jest.fn((_status: TStatus, body: { message: string, success: false }) => body)

const buildHarness = () => {
  const logger: jest.Mocked<ILogger> = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const lifecycleService = { recordWebhook: jest.fn(async () => undefined) }
  const verify = jest.fn(async () => payload)
  const controller = new ResendWebhookController(
    logger,
    lifecycleService as unknown as PartnerPortalEmailDeliveryLifecycleService,
    { verify } as unknown as ResendWebhookVerifier,
  )
  const request = {
    header: jest.fn((name: string) => ({
      'svix-id': 'evt_111111111111111111111111',
      'svix-signature': 'v1,signature',
      'svix-timestamp': '1785769200',
    })[name]),
    rawBody: Buffer.from(JSON.stringify(payload)),
  } as unknown as ExpressRequest & { rawBody: Buffer }
  return { controller, lifecycleService, logger, request, verify }
}

describe('ResendWebhookController', () => {
  it('records only the signed event identity, type, time, and provider message ID', async () => {
    const harness = buildHarness()
    const setStatus = jest.spyOn(harness.controller, 'setStatus')

    const result = await harness.controller.handle(
      payload,
      harness.request,
      responder<400>(),
      responder<401>(),
      responder<500>(),
    )

    expect(result).toEqual({ message: 'Webhook processed', success: true })
    expect(setStatus).toHaveBeenCalledWith(200)
    expect(harness.lifecycleService.recordWebhook).toHaveBeenCalledWith({
      eventId: 'evt_111111111111111111111111',
      eventType: 'email.delivered',
      occurredAt: new Date('2026-08-03T15:00:00.000Z'),
      providerMessageId: 'resend-message-1',
    })
    expect(JSON.stringify(harness.lifecycleService.recordWebhook.mock.calls)).not.toContain(
      'admin@atlas.example',
    )
  })

  it('rejects missing raw bytes and invalid signatures before lifecycle processing', async () => {
    const missingBodyHarness = buildHarness()
    const missingBodyRequest = {
      header: missingBodyHarness.request.header,
      rawBody: undefined,
    } as unknown as Parameters<ResendWebhookController['handle']>[1]
    const unauthorized = responder<401>()
    await missingBodyHarness.controller.handle(
      payload,
      missingBodyRequest,
      responder<400>(),
      unauthorized,
      responder<500>(),
    )
    expect(unauthorized).toHaveBeenCalledWith(401, {
      message: 'Invalid webhook signature',
      success: false,
    })
    expect(missingBodyHarness.verify).not.toHaveBeenCalled()

    const invalidSignatureHarness = buildHarness()
    invalidSignatureHarness.verify.mockRejectedValueOnce(new ResendWebhookSignatureError())
    await invalidSignatureHarness.controller.handle(
      payload,
      invalidSignatureHarness.request,
      responder<400>(),
      responder<401>(),
      responder<500>(),
    )
    expect(invalidSignatureHarness.lifecycleService.recordWebhook).not.toHaveBeenCalled()
  })

  it('rejects a signed unsupported payload without storing it', async () => {
    const harness = buildHarness()
    harness.verify.mockResolvedValueOnce({ ...payload, type: 'email.opened' })
    const badRequest = responder<400>()

    const result = await harness.controller.handle(
      payload,
      harness.request,
      badRequest,
      responder<401>(),
      responder<500>(),
    )

    expect(result).toEqual({ message: 'Invalid webhook payload', success: false })
    expect(harness.lifecycleService.recordWebhook).not.toHaveBeenCalled()
  })
})
