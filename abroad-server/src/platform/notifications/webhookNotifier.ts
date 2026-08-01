import { WebhookCredentialMode } from '@prisma/client'
import axios from 'axios'
import { inject, injectable } from 'inversify'

import { RuntimeConfiguration } from '../../app/config/runtime'
import { TYPES } from '../../app/container/types'
import { ILogger } from '../../core/logging/types'
import { PartnerWebhookSecretResolver } from '../../modules/partners/application/PartnerWebhookSecretResolver'
import { ISecretManager } from '../secrets/ISecretManager'
import {
  IWebhookNotifier,
  WebhookDeliveryContext,
  WebhookDeliveryError,
  WebhookDeliveryResult,
  WebhookEvent,
} from './IWebhookNotifier'
import { WebhookTargetPolicy, WebhookTargetValidationError } from './WebhookTargetPolicy'

type WebhookPayload = {
  data: Record<string, unknown>
  event: WebhookEvent
}

type WebhookSecrets = {
  byOrigin: ReadonlyMap<string, string>
  fallback: string | undefined
}

const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1_024

class WebhookCredentialUnavailableError extends Error {
  public constructor() {
    super('Managed webhook credential is unavailable')
    this.name = 'WebhookCredentialUnavailableError'
  }
}

@injectable()
export class WebhookNotifier implements IWebhookNotifier {
  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.AppConfig) private readonly config: RuntimeConfiguration,
    @inject(PartnerWebhookSecretResolver)
    private readonly partnerSecretResolver: PartnerWebhookSecretResolver,
    @inject(WebhookTargetPolicy)
    private readonly targetPolicy: WebhookTargetPolicy,
  ) {}

  public async notifyWebhook(
    url: null | string,
    payload: WebhookPayload,
    context: WebhookDeliveryContext = {
      credentialMode: null,
      partnerId: null,
    },
  ): Promise<WebhookDeliveryResult> {
    const target = this.normalizeUrl(url)
    if (!target) {
      return { durationMs: 0, httpStatus: 204 }
    }

    const startedAt = Date.now()
    let destroyAgent: (() => void) | undefined
    try {
      const validatedTarget = await this.targetPolicy.validate(target)
      destroyAgent = () => validatedTarget.httpsAgent.destroy()
      const secret = await this.resolveSecret(validatedTarget.url, context)
      const response = await axios.post(validatedTarget.url, payload, {
        headers: secret ? { 'X-Abroad-Webhook-Secret': secret } : undefined,
        httpsAgent: validatedTarget.httpsAgent,
        maxBodyLength: MAX_WEBHOOK_RESPONSE_BYTES,
        maxContentLength: MAX_WEBHOOK_RESPONSE_BYTES,
        maxRedirects: 0,
        timeout: this.config.axiosTimeoutMs,
      })
      return {
        durationMs: Math.max(0, Date.now() - startedAt),
        httpStatus: response.status,
      }
    }
    catch (error) {
      const durationMs = Math.max(0, Date.now() - startedAt)
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      const failureCode = this.toFailureCode(error, status)
      this.logger.error('Failed to notify webhook', {
        durationMs,
        event: payload.event,
        failureCode,
        status,
        targetOrigin: this.readTargetOrigin(target),
      })
      throw new WebhookDeliveryError({ durationMs, failureCode, httpStatus: status })
    }
    finally {
      destroyAgent?.()
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
    catch {
      this.logger.warn('Failed to fetch webhook secret; continuing without authentication header', {
        error: new Error('Secret resolution failed'),
      })
      return undefined
    }
  }

  private async resolveLegacySecret(target: string): Promise<string | undefined> {
    const secrets = await this.resolveWebhookSecrets()
    const targetOrigin = this.tryReadTargetOrigin(target)
    return (targetOrigin ? secrets.byOrigin.get(targetOrigin) : undefined)
      ?? secrets.fallback
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

  private async resolveSecret(
    target: string,
    context: WebhookDeliveryContext,
  ): Promise<string | undefined> {
    if (
      context.partnerId
      && context.credentialMode
      && context.credentialMode !== WebhookCredentialMode.LEGACY_ORIGIN
    ) {
      const managedSecret = await this.partnerSecretResolver.resolve(
        context.partnerId,
        context.credentialMode,
      )
      if (managedSecret) {
        return managedSecret
      }
      throw new WebhookCredentialUnavailableError()
    }
    return this.resolveLegacySecret(target)
  }

  private async resolveWebhookSecrets(): Promise<WebhookSecrets> {
    const [byOrigin, fallback] = await Promise.all([
      this.resolvePerOriginWebhookSecrets(),
      this.resolveDefaultWebhookSecret(),
    ])
    return { byOrigin, fallback }
  }

  private toFailureCode(error: unknown, status: number | undefined): string {
    if (error instanceof WebhookTargetValidationError) {
      return 'target_rejected'
    }
    if (error instanceof WebhookCredentialUnavailableError) {
      return 'credential_unavailable'
    }
    if (status !== undefined) {
      return 'http_error'
    }
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      return 'timeout'
    }
    return 'network_error'
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
