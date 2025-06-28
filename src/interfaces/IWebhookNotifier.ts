export enum WebhookEvent {
  TRANSACTION_CREATED = 'transaction.created',
  TRANSACTION_UPDATED = 'transaction.updated',
}
export interface IWebhookNotifier {
  notifyWebhook(
    url: null | string,
    payload: {
      data: Record<string, unknown>
      event: WebhookEvent
    }
  ): Promise<void>
}
