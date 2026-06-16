import axios from 'axios'

import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

type TransferoAccount = {
  accountId?: string
  currency?: string
  depositAddress?: null | Record<string, string>
  label?: string
}

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

// Idempotency is matched against the entityType Transfero returns from GET
// /callback/v2.0/subscription: deposit-order callbacks report "DepositOrder",
// and credit-transaction callbacks report "Transaction" (not "CreditTransaction").
const REQUIRED_CALLBACKS = [
  { label: 'deposit', match: /deposit/i, path: 'depositorders' },
  { label: 'credit', match: /transaction|credit/i, path: 'credittransactions' },
] as const

/**
 * Ensures Transfero is configured to POST deposit/credit notifications to our
 * webhook. Crypto deposits are credited to the per-currency CRYPTO accounts
 * (e.g. USDC/USDT), NOT the BRL account — so the deposit/credit callbacks must
 * be subscribed on each crypto account. We discover accounts via GET
 * /api/v2.0/accounts and subscribe the deposit-capable ones (those with a
 * crypto depositAddress). Idempotent and self-healing on each startup.
 * Must run from an allowlisted egress (prod); best-effort — never blocks boot.
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
        TRANSFERO_BASE_URL: baseUrl,
        TRANSFERO_CLIENT_ID: clientId,
        TRANSFERO_CLIENT_SCOPE: scope,
        TRANSFERO_CLIENT_SECRET: clientSecret,
      } = await this.secretManager.getSecrets([
        'TRANSFERO_BASE_URL',
        'TRANSFERO_CLIENT_ID',
        'TRANSFERO_CLIENT_SCOPE',
        'TRANSFERO_CLIENT_SECRET',
      ])

      if (!baseUrl) {
        this.logger.warn('Transfero base URL missing; skipping Transfero callback registration')
        return
      }

      const webhookUrl = await this.resolveWebhookUrl()
      const token = await this.getAccessToken({ baseUrl, clientId, clientSecret, scope })

      const accounts = await this.fetchAccounts({ baseUrl, token })
      // Deposit-capable (crypto) accounts have a populated depositAddress object;
      // the BRL account has depositAddress: null and only receives payments.
      const cryptoAccounts = accounts.filter(account =>
        typeof account.accountId === 'string'
        && account.depositAddress != null
        && typeof account.depositAddress === 'object')

      if (cryptoAccounts.length === 0) {
        this.logger.warn('No deposit-capable Transfero accounts found; skipping callback registration', {
          accountCount: accounts.length,
        })
        return
      }

      for (const account of cryptoAccounts) {
        await this.ensureAccountSubscriptions({
          accountId: account.accountId as string,
          baseUrl,
          currency: account.currency,
          token,
          webhookUrl,
        })
      }
    }
    catch (error) {
      // Best-effort: callback registration must never block service startup.
      this.logger.error('Failed to ensure Transfero callback subscriptions', error)
    }
  }

  private async ensureAccountSubscriptions(params: {
    accountId: string
    baseUrl: string
    currency?: string
    token: string
    webhookUrl: string
  }): Promise<void> {
    const { accountId, baseUrl, currency, token, webhookUrl } = params
    const existing = await this.fetchSubscriptions({ accountId, baseUrl, token })

    for (const callback of REQUIRED_CALLBACKS) {
      try {
        const alreadyRegistered = existing.some(subscription =>
          subscription.notificationTo === webhookUrl
          && typeof subscription.entityType === 'string'
          && callback.match.test(subscription.entityType))

        if (alreadyRegistered) {
          this.logger.info('Transfero callback already registered', { accountId, currency, type: callback.label })
          continue
        }

        await this.subscribe({ accountId, baseUrl, path: callback.path, token, webhookUrl })
        this.logger.info('Registered Transfero callback', { accountId, currency, notificationTo: webhookUrl, type: callback.label })
      }
      catch (error) {
        this.logger.error('Failed to register Transfero callback', { accountId, error, type: callback.label })
      }
    }
  }

  private async fetchAccounts(params: { baseUrl: string, token: string }): Promise<TransferoAccount[]> {
    const { baseUrl, token } = params
    const { data } = await axios.get(
      `${baseUrl}/api/v2.0/accounts`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    )
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    return Array.isArray(parsed) ? parsed as TransferoAccount[] : []
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
