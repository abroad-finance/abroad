import axios from 'axios'
import { inject, injectable } from 'inversify'

import { RuntimeConfiguration } from '../../app/config/runtime'
import { TYPES } from '../../app/container/types'
import { ILogger } from '../../core/logging/types'
import { ISecretManager } from '../secrets/ISecretManager'
import { IWebhookNotifier, WebhookEvent } from './IWebhookNotifier'

type WebhookPayload = {
  data: Record<string, unknown>
  event: WebhookEvent
}

type WebhookSecrets = {
  byOrigin: ReadonlyMap<string, string>
  fallback: string | undefined
}

@injectable()
export class WebhookNotifier implements IWebhookNotifier {
  public constructor(
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.AppConfig) private readonly config: RuntimeConfiguration,
  ) { }

  async notifyWebhook(
    url: null | string,
    payload: WebhookPayload,
  ): Promise<void> {
    const target = this.normalizeUrl(url)
    if (!target) {
      return
    }

    const secrets = await this.resolveWebhookSecrets()
    await this.deliverWebhook(
      target,
      payload,
      this.selectWebhookSecret(target, secrets),
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
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      const normalizedError = new Error(
        status
          ? `Webhook delivery failed with HTTP ${status}`
          : 'Webhook delivery failed',
        { cause: error },
      )
      this.logger.error('Failed to notify webhook', {
        error: normalizedError,
        event: payload.event,
        status,
        targetOrigin: this.readTargetOrigin(target),
      })
      throw normalizedError
    }
  }

  private normalizeUrl(url: null | string): null | string {
    if (typeof url !== 'string') {
      return null
    }
    const trimmed = url.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private parseWebhookSecretsByOrigin(rawConfiguration: string): ReadonlyMap<string, string> {
    const parsedConfiguration: unknown = JSON.parse(rawConfiguration)
    if (
      typeof parsedConfiguration !== 'object'
      || parsedConfiguration === null
      || Array.isArray(parsedConfiguration)
    ) {
      throw new Error('Per-origin webhook secrets must be a JSON object')
    }

    const secretsByOrigin = new Map<string, string>()
    for (const [configuredOrigin, configuredSecret] of Object.entries(
      parsedConfiguration as Record<string, unknown>,
    )) {
      const normalizedOrigin = this.tryReadTargetOrigin(configuredOrigin)
      if (!normalizedOrigin || normalizedOrigin !== configuredOrigin) {
        throw new Error('Per-origin webhook secret keys must be canonical URL origins')
      }
      if (typeof configuredSecret !== 'string' || !configuredSecret.trim()) {
        throw new Error('Per-origin webhook secret values must be non-empty strings')
      }
      secretsByOrigin.set(normalizedOrigin, configuredSecret)
    }

    return secretsByOrigin
  }

  private readTargetOrigin(target: string): string {
    return this.tryReadTargetOrigin(target) ?? 'invalid-url'
  }

  private async resolveDefaultWebhookSecret(): Promise<string | undefined> {
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

  private async resolvePerOriginWebhookSecrets(): Promise<ReadonlyMap<string, string>> {
    try {
      const configuration = await this.secretManager.getSecret(
        'ABROAD_WEBHOOK_SECRETS_BY_ORIGIN',
      )
      return this.parseWebhookSecretsByOrigin(configuration)
    }
    catch {
      this.logger.warn(
        'Failed to resolve per-origin webhook secrets; using default webhook secret',
      )
      return new Map()
    }
  }

  private async resolveWebhookSecrets(): Promise<WebhookSecrets> {
    const [byOrigin, fallback] = await Promise.all([
      this.resolvePerOriginWebhookSecrets(),
      this.resolveDefaultWebhookSecret(),
    ])
    return { byOrigin, fallback }
  }

  private selectWebhookSecret(
    target: string,
    secrets: WebhookSecrets,
  ): string | undefined {
    const targetOrigin = this.tryReadTargetOrigin(target)
    return (targetOrigin ? secrets.byOrigin.get(targetOrigin) : undefined)
      ?? secrets.fallback
  }

  private tryReadTargetOrigin(target: string): null | string {
    try {
      return new URL(target).origin
    }
    catch {
      return null
    }
  }
}
