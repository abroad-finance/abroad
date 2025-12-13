import axios from 'axios'
import { inject, injectable } from 'inversify'

import { RuntimeConfiguration } from '../../app/config/runtime'
import { TYPES } from '../../app/container/types'
import { ILogger } from '../../core/logging/types'
import { ISecretManager } from '../secrets/ISecretManager'
import { IWebhookNotifier, WebhookEvent } from './IWebhookNotifier'

@injectable()
export class WebhookNotifier implements IWebhookNotifier {
  public constructor(
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.AppConfig) private readonly config: RuntimeConfiguration,
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
      await axios.post(url, payload, {
        headers,
        timeout: this.config.axiosTimeoutMs,
      })
    }
    catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      this.logger.error('Failed to notify webhook', {
        error: normalizedError,
        event: payload.event,
        url,
      })
    }
  }
}
