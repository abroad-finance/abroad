import axios from 'axios'

import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

type TransferoSubscription = {
  entityType?: string
  id?: string
  notificationTo?: string
  notificationType?: string
}

/**
 * Default public webhook URL Transfero should POST deposit/credit events to.
 * Overridable per-environment via the TRANSFERO_WEBHOOK_URL secret; the default
 * keeps the fix self-contained so a fresh deploy restores delivery with no
 * extra config step. Only ever used from prod (allowlisted Transfero egress).
 */
export const DEFAULT_TRANSFERO_WEBHOOK_URL = 'https://api.abroad.finance/webhook/transfero/balance'

/**
 * The deposit/credit callbacks both notify the same `/webhook/transfero/balance`
 * endpoint, so we distinguish them by entity type when checking idempotency.
 */
// Idempotency is matched against the entityType Transfero returns from GET
// /callback/v2.0/subscription: deposit-order callbacks report "DepositOrder",
// and credit-transaction callbacks report "Transaction" (not "CreditTransaction").
const REQUIRED_CALLBACKS = [
  { label: 'deposit', match: /deposit/i, path: 'depositorders' },
  { label: 'credit', match: /transaction|credit/i, path: 'credittransactions' },
] as const

/**
 * Ensures Transfero is configured to POST deposit/credit notifications to our
 * webhook. Transfero requires an explicit per-account, per-event-type callback
 * subscription; if it lapses (e.g. auto-disabled after repeated delivery
 * failures) deposits stop notifying us and `AWAIT_EXCHANGE_BALANCE` flow steps
 * never resume. Running this idempotently at startup keeps the subscription
 * self-healing. Must run from an allowlisted egress (prod), never blocks boot.
 */
export class TransferoCallbackRegistrar {
  private readonly logger: ScopedLogger

  constructor(
    private readonly secretManager: ISecretManager,
    baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoCallbackRegistrar' })
  }

  public async ensureSubscriptions(): Promise<void> {
    try {
      const {
        TRANSFERO_ACCOUNT_ID: accountId,
        TRANSFERO_BASE_URL: baseUrl,
        TRANSFERO_CLIENT_ID: clientId,
        TRANSFERO_CLIENT_SCOPE: scope,
        TRANSFERO_CLIENT_SECRET: clientSecret,
      } = await this.secretManager.getSecrets([
        'TRANSFERO_ACCOUNT_ID',
        'TRANSFERO_BASE_URL',
        'TRANSFERO_CLIENT_ID',
        'TRANSFERO_CLIENT_SCOPE',
        'TRANSFERO_CLIENT_SECRET',
      ])

      if (!baseUrl || !accountId) {
        this.logger.warn('Transfero base URL or account id missing; skipping Transfero callback registration')
        return
      }

      const webhookUrl = await this.resolveWebhookUrl()
      const token = await this.getAccessToken({ baseUrl, clientId, clientSecret, scope })
      const existing = await this.fetchSubscriptions({ accountId, baseUrl, token })

      for (const callback of REQUIRED_CALLBACKS) {
        try {
          const alreadyRegistered = existing.some(subscription =>
            subscription.notificationTo === webhookUrl
            && typeof subscription.entityType === 'string'
            && callback.match.test(subscription.entityType))

          if (alreadyRegistered) {
            this.logger.info('Transfero callback already registered', { type: callback.label })
            continue
          }

          await this.subscribe({ accountId, baseUrl, path: callback.path, token, webhookUrl })
          this.logger.info('Registered Transfero callback', { notificationTo: webhookUrl, type: callback.label })
        }
        catch (error) {
          this.logger.error('Failed to register Transfero callback', { error, type: callback.label })
        }
      }
    }
    catch (error) {
      // Best-effort: callback registration must never block service startup.
      this.logger.error('Failed to ensure Transfero callback subscriptions', error)
    }
  }

  private async fetchSubscriptions(params: { accountId: string, baseUrl: string, token: string }): Promise<TransferoSubscription[]> {
    const { accountId, baseUrl, token } = params
    const { data } = await axios.get(
      `${baseUrl}/callback/v2.0/subscription/accounts/${accountId}`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    )
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    return Array.isArray(parsed) ? parsed as TransferoSubscription[] : []
  }

  /** OAuth2 client-credentials flow (mirrors TransferoExchangeProvider). */
  private async getAccessToken(params: { baseUrl: string, clientId: string, clientSecret: string, scope: string }): Promise<string> {
    const { baseUrl, clientId, clientSecret, scope } = params
    const { data } = await axios.post(
      `${baseUrl}/auth/token`,
      { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope },
      { headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } },
    )
    return data?.access_token ?? data
  }

  /** Resolve the webhook URL: TRANSFERO_WEBHOOK_URL secret if set, else the default. */
  private async resolveWebhookUrl(): Promise<string> {
    try {
      const configured = await this.secretManager.getSecret('TRANSFERO_WEBHOOK_URL')
      if (configured) {
        return configured
      }
    }
    catch {
      // Secret not provisioned; fall back to the built-in default below.
    }
    return DEFAULT_TRANSFERO_WEBHOOK_URL
  }

  private async subscribe(params: { accountId: string, baseUrl: string, path: string, token: string, webhookUrl: string }): Promise<void> {
    const { accountId, baseUrl, path, token, webhookUrl } = params
    await axios.post(
      `${baseUrl}/callback/v2.0/subscribe/${path}/accounts/${accountId}`,
      { notification: webhookUrl, notificationType: 'Webhook' },
      { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
    )
  }
}
