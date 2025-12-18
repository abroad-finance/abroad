import axios from 'axios'
import { inject, injectable } from 'inversify'

import { RuntimeConfiguration } from '../../app/config/runtime'
import { TYPES } from '../../app/container/types'
import { ILogger } from '../../core/logging/types'
import { IDatabaseClientProvider } from '../persistence/IDatabaseClientProvider'
import { ISecretManager } from '../secrets/ISecretManager'
import { IWebhookNotifier, WebhookEvent } from './IWebhookNotifier'

type WebhookPayload = {
  data: Record<string, unknown>
  event: WebhookEvent
}

@injectable()
export class WebhookNotifier implements IWebhookNotifier {
  private sepPartnerWebhookUrlPromise?: Promise<null | string>

  public constructor(
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.AppConfig) private readonly config: RuntimeConfiguration,
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) { }

  async notifyWebhook(
    url: null | string,
    payload: WebhookPayload,
  ): Promise<void> {
    const targets = await this.resolveTargets(url)
    if (targets.length === 0) {
      return
    }

    const secret = await this.resolveWebhookSecret()

    await Promise.all(
      targets.map(target => this.deliverWebhook(target, payload, secret)),
    )
  }

  private async deliverWebhook(
    target: string,
    payload: WebhookPayload,
    secret: string | undefined,
  ): Promise<void> {
    try {
      await axios.post(target, payload, {
        headers: secret ? { 'X-Abroad-Webhook-Secret': secret } : undefined,
        timeout: this.config.axiosTimeoutMs,
      })
    }
    catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      this.logger.error('Failed to notify webhook', {
        error: normalizedError,
        event: payload.event,
        url: target,
      })
    }
  }

  private async fetchSepPartnerWebhookUrl(): Promise<null | string> {
    const [sepPartnerId, prismaClient] = await Promise.all([
      this.secretManager.getSecret('STELLAR_SEP_PARTNER_ID'),
      this.databaseClientProvider.getClient(),
    ])

    if (!sepPartnerId) {
      return null
    }

    const sepPartner = await prismaClient.partner.findUnique({
      select: { webhookUrl: true },
      where: { id: sepPartnerId },
    })

    const normalizedUrl = this.normalizeUrl(sepPartner?.webhookUrl ?? null)
    return normalizedUrl
  }

  private async getSepPartnerWebhookUrl(): Promise<null | string> {
    if (!this.sepPartnerWebhookUrlPromise) {
      this.sepPartnerWebhookUrlPromise = this.fetchSepPartnerWebhookUrl()
    }

    try {
      return await this.sepPartnerWebhookUrlPromise
    }
    catch (error) {
      this.logger.warn('Failed to resolve SEP partner webhook URL; skipping SEP notification', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
      this.sepPartnerWebhookUrlPromise = undefined
      return null
    }
  }

  private normalizeUrl(url: null | string): null | string {
    if (typeof url !== 'string') {
      return null
    }
    const trimmed = url.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private async resolveTargets(primaryUrl: null | string): Promise<string[]> {
    const targets: string[] = []
    const normalizedPrimary = this.normalizeUrl(primaryUrl)
    if (normalizedPrimary) {
      targets.push(normalizedPrimary)
    }

    const sepWebhookUrl = await this.getSepPartnerWebhookUrl()
    if (sepWebhookUrl && !targets.includes(sepWebhookUrl)) {
      targets.push(sepWebhookUrl)
    }

    return targets
  }

  private async resolveWebhookSecret(): Promise<string | undefined> {
    try {
      const secret = await this.secretManager.getSecret('ABROAD_WEBHOOK_SECRET')
      return secret?.trim() ? secret : undefined
    }
    catch (error) {
      this.logger.warn('Failed to fetch webhook secret; continuing without authentication header', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return undefined
    }
  }
}
