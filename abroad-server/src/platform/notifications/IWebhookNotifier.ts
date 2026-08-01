import { WebhookCredentialMode } from '@prisma/client'

export enum WebhookEvent {
  TRANSACTION_CREATED = 'transaction.created',
  TRANSACTION_UPDATED = 'transaction.updated',
  WEBHOOK_TEST = 'webhook.test',
}

export interface IWebhookNotifier {
  notifyWebhook(
    url: null | string,
    payload: {
      data: Record<string, unknown>
      event: WebhookEvent
    },
    context?: WebhookDeliveryContext,
  ): Promise<WebhookDeliveryResult>
}

export type WebhookDeliveryContext = {
  credentialMode: null | WebhookCredentialMode
  partnerId: null | string
}

export type WebhookDeliveryResult = {
  durationMs: number
  httpStatus: number
}
export class WebhookDeliveryError extends Error {
  public readonly durationMs: number
  public readonly failureCode: string
  public readonly httpStatus: null | number

  public constructor(input: {
    durationMs: number
    failureCode: string
    httpStatus?: number
  }) {
    super('Webhook delivery failed')
    this.name = 'WebhookDeliveryError'
    this.durationMs = input.durationMs
    this.failureCode = input.failureCode
    this.httpStatus = input.httpStatus ?? null
  }
}
