import axios from 'axios'
import { inject, injectable } from 'inversify'

import { ILogger } from '../interfaces'
import { IWebhookNotifier, WebhookEvent } from '../interfaces/IWebhookNotifier'
import { TYPES } from '../types'

@injectable()
export class WebhookNotifier implements IWebhookNotifier {
  public constructor(
        @inject(TYPES.ILogger) private logger: ILogger,
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
      await axios.post(url, payload)
    }
    catch (error) {
      this.logger.error(`Failed to notify webhook: ${url}`, error)
    }
  }
}
