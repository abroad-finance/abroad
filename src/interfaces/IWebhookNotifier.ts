export interface IWebhookNotifier {
  notify(
    partnerId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void>
}
