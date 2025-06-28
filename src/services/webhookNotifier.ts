import axios from 'axios'
import { inject } from 'inversify'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IWebhookNotifier } from '../interfaces/IWebhookNotifier'
import { TYPES } from '../types'

export class WebhookNotifier implements IWebhookNotifier {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private dbProvider: IDatabaseClientProvider,
  ) {}

  async notify(
    partnerId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const prisma = await this.dbProvider.getClient()
      const partner = (await prisma.partner.findUnique({
        where: { id: partnerId },
      })) as { webhookUrl?: string } | null
      const url = partner?.webhookUrl
      if (!url) {
        return
      }
      await axios.post(url, { event, payload })
    }
    catch (error) {
      if (error instanceof Error) {
        console.warn('Failed to send webhook:', error.message)
      }
    }
  }
}
