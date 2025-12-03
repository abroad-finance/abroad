import axios from 'axios'
import { inject, injectable } from 'inversify'

import { ILogger } from '../interfaces'
import { ISecretManager } from '../interfaces/ISecretManager'
import { IWebhookNotifier, WebhookEvent } from '../interfaces/IWebhookNotifier'
import { TYPES } from '../types'

@injectable()
export class WebhookNotifier implements IWebhookNotifier {
  public constructor(
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  async notifyWebhook(
    url: null | string,
    payload: {
      data: Record<string, unknown>
      event: WebhookEvent
    },
  ): Promise<void> {
    if (!url) {
      return
    }

    try {
      const secret = await this.secretManager.getSecret('ABROAD_WEBHOOK_SECRET')
      const headers = secret ? { 'X-Abroad-Webhook-Secret': secret } : undefined
      await axios.post(url, payload, { headers })
    }
    catch {
      this.logger.error(`Failed to notify webhook: ${url}`)
    }
  }
}
