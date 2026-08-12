import { PaymentMethod, TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject, injectable } from 'inversify'
import { randomInt } from 'node:crypto'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import {
  IPaymentService,
  PaymentCapability,
  PaymentFailureCode,
  PaymentOnboardResult,
  PaymentSendResult,
} from '../../application/contracts/IPaymentService'

interface BrebApiEnvelope<T> {
  code?: string
  data?: T
  message?: string
}

interface BrebKeyDetails {
  accountNumber?: string
  documentNumber?: string
  documentType?: string
  entityId?: string
  instructedAgent?: string
  keyId?: string
  keyState?: string
  merchantId?: null | string
  name?: string
  partyIdentifier?: string
  partySystemIdentifier?: string
  partyType?: string
  rail?: BrebRail
  subType?: string
  typeAccount?: string
}

type BrebRail = string

interface BrebSendPayload {
  creditor_account_number: string
  creditor_document_number: string
  creditor_document_type: string
  creditor_entity_id: string
  creditor_instructed_agent: string
  creditor_key_id: string
  creditor_merchant_id?: string
  creditor_name: string
  creditor_party_identifier: string
  creditor_party_system_identifier: string
  creditor_party_type: string
  creditor_sub_type: string
  creditor_type_account: string
  transaction_note: string
  transaction_total_amount: number
}

interface BrebSendResponseData {
  moviiTxId?: string
  rail?: BrebRail
}

interface BrebServiceConfig {
  apiBaseUrl: string
  authUrl: string
  clientId: string
  clientSecret: string
  dadAccount: string
  productCode: string
}

interface BrebTokenResponse {
  access_token: string
  expires_in: number
  token_type?: string
}

type BrebTransactionOutcome = 'failure' | 'pending' | 'success'

interface BrebTransactionReport {
  Creditor?: {
    TransactionInfAndSts?: BrebTransactionStatusInfo
  }
  Debtor?: {
    TransactionInfAndSts?: BrebTransactionStatusInfo
  }
  GlobalTransactionInfAndSts?: {
    Currency?: string
    GlobalTxStatus?: string
    OriginalCtrlSumAmt?: string
    TransactionDateTime?: string
  }
  TransactionDirectoryId?: string
  TransactionID?: string
}

interface BrebTransactionStatusInfo {
  ResponseCode?: string
  TransactionStatus?: string
  TransactionStatusRsnInf?: string
}

/**
 * BTB get-balance is a separate Movii product with its own OAuth client, so it
 * carries its own host and credentials rather than borrowing the Bre-B ones.
 */
interface MoviiBalanceConfig {
  authorization: string
  authUrl: string
  clientId: string
  clientSecret: string
  endpoint: string
}

/**
 * BTB CO GET BALANCE PASSWORD SUBSCRIBER always answers HTTP 200 and carries the
 * real outcome in `code`/`message`, so the body is the only thing worth reading.
 *
 * Observed success body:
 *   { "code": 200, "message": "Transacción exitosa",
 *     "correlationId": "<uuid>",
 *     "data": { "TYPE": "ALLWCBLREQ", "TXNID": "...", "BALANCE": 3156118.38,
 *               "TXNSTATUS": 200, "FICBALANCE": 0, "OTHERWALLETS": "",
 *               "TRID": "..." } }
 *
 * Note `code` arrives as a JSON number even though the spec types it as text(3).
 */
interface MoviiBalanceEnvelope {
  code?: number | string
  /** The provider's own id, unrelated to the correlationid we send. */
  correlationId?: string
  data?: unknown
  message?: string
}

@injectable()
export class BrebPaymentService implements IPaymentService {
  public readonly capability: PaymentCapability = {
    method: PaymentMethod.BREB,
    targetCurrency: TargetCurrency.COP,
  }

  public readonly currency = TargetCurrency.COP
  public readonly fixedFee = 0

  public readonly isAsync = false
  public readonly isEnabled = true

  // Bre-B imposes no amount or count ceiling of its own, and the platform's
  // own caps were counting accepted transactions that were never paid: an
  // abandoned checkout consumed the allowance permanently, because the daily
  // and monthly counters are only ever incremented. That exhausted a partner's
  // day on transactions that moved no money. The corridor's own minAmount and
  // maxAmount remain the amount bound, and liquidity is still checked per
  // payout, so removing these leaves the real guards in place.
  public readonly MAX_TOTAL_AMOUNT_PER_DAY = Number.POSITIVE_INFINITY
  public readonly MAX_USER_AMOUNT_PER_DAY = Number.POSITIVE_INFINITY
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION = Number.POSITIVE_INFINITY
  public readonly MAX_USER_TRANSACTIONS_PER_DAY = Number.POSITIVE_INFINITY

  // Kept: this is the rail's own floor, not a platform-imposed cap.
  public readonly MIN_USER_AMOUNT_PER_TRANSACTION = 5_000

  public readonly percentageFee = 0

  public readonly provider = 'breb'
  private accessTokenCache?: { expiresAt: number, value: string }

  // Confirmed against the live endpoint: the float arrives as `BALANCE`.
  // Matched case-insensitively, and deliberately an exact name — the same
  // object also carries `FICBALANCE`, which is a different figure.
  private readonly balanceFieldNames: ReadonlySet<string> = new Set(['balance'])

  // The response table calls '00' success; the error table lists '200'. Movii
  // ships both spellings, so honour both rather than betting on one.
  private readonly balanceSuccessCodes: ReadonlySet<string> = new Set(['00', '000', '200'])

  // Movii answers a key lookup for an unregistered or badly formatted Bre-B key
  // with HTTP 400 and one of these codes. That is the customer mistyping their
  // key, not the rail failing, so it must not page anyone.
  private readonly customerInputResponseCodes: ReadonlySet<string> = new Set([
    'SR08', // Key format not supported
    'U804', // La llave y/o documento no existe o esta inactiva
  ])

  private readonly liquidityRateLimitCooldownMs: number

  private liquidityRateLimitedUntilMs = 0

  private readonly liquidityRequestTimeoutMs: number

  private readonly mandatoryKeyFields: ReadonlyArray<keyof BrebKeyDetails> = [
    'accountNumber',
    'documentNumber',
    'documentType',
    'instructedAgent',
    'keyId',
    'name',
    'partyIdentifier',
    'partySystemIdentifier',
    'partyType',
    'subType',
    'typeAccount',
  ]

  private readonly maxSendAttempts: number

  private moviiBalanceConfig?: MoviiBalanceConfig

  // Versioned here rather than folded into the secret: the host moves between
  // environments, the route is part of the contract this file implements.
  private readonly moviiBalancePath = '/core/co/btb-balance-password-subscriber/get-balance'

  // Kept apart from accessTokenCache: a rejected balance bearer must not
  // invalidate the payment client's token, and vice versa.
  private moviiBalanceTokenCache?: { expiresAt: number, value: string }

  private readonly pollConfig = {
    delayMs: 2_000,
    timeoutMs: 60_000,
  }

  private readonly retryDelayMs: number

  private serviceConfig?: BrebServiceConfig

  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    this.maxSendAttempts = this.readNumberFromEnv('BREB_MAX_SEND_ATTEMPTS', 3)
    this.retryDelayMs = this.readNumberFromEnv('BREB_RETRY_DELAY_MS', 500)
    this.liquidityRequestTimeoutMs = this.readNumberFromEnv('BREB_LIQUIDITY_TIMEOUT_MS', 5_000)
    this.liquidityRateLimitCooldownMs = this.readNumberFromEnv('BREB_LIQUIDITY_RATE_LIMIT_COOLDOWN_MS', 60_000)
  }

  /**
   * Rejects when the balance cannot be read, per the IPaymentService contract —
   * a provider failure must never be reported as a zero float.
   */
  public async getLiquidity(): Promise<number> {
    if (Date.now() < this.liquidityRateLimitedUntilMs) {
      // Movii keeps answering 429 for a while once its limit trips, and every
      // extra call inside that window prolongs it. Fail fast so the liquidity
      // cache serves its last good value instead of us hammering the provider.
      throw new Error('Movii balance endpoint is rate limited; skipping request')
    }

    const config = await this.getMoviiBalanceConfig()
    const token = await this.getMoviiBalanceAccessToken(config)
    const envelope = await this.requestMoviiBalance(config, token)

    // Movii sends `code` as a number despite the spec typing it as text, so
    // normalise before comparing — reading it as a string only skipped the
    // check, letting a numeric error code through unexamined.
    const code = this.normalizeResponseCode(envelope.code)
    if (code && !this.balanceSuccessCodes.has(code)) {
      // '401 AUTHORZATION INVALID' means the bearer we cached is no longer
      // accepted; drop it so the next read re-authenticates instead of
      // replaying a token Movii has already rejected.
      if (code === '401') {
        this.moviiBalanceTokenCache = undefined
      }
      this.logger.error('[BreB] Liquidity request rejected by Movii', {
        responseCode: code,
        responseMessage: envelope.message ?? null,
      })
      throw new Error(`Movii balance request failed with code ${code}: ${envelope.message ?? 'no message'}`)
    }

    const balance = this.extractBalance(envelope.data)
    if (balance === null) {
      this.logger.error('[BreB] Liquidity response missing balance', {
        responseCode: code,
        responseFields: this.describeBalanceFields(envelope.data),
        responseMessage: envelope.message ?? null,
      })
      throw new Error('Movii balance response did not include a usable balance')
    }

    return balance
  }

  public async onboardUser(): Promise<PaymentOnboardResult> {
    return { message: 'BreB does not require explicit onboarding', success: true } satisfies PaymentOnboardResult
  }

  public async sendPayment({
    account,
    value,
  }: {
    account: string
    id: string
    qrCode?: null | string
    value: number
  }): Promise<PaymentSendResult> {
    let attempt = 0
    let lastTransactionId: null | string = null
    while (attempt < this.maxSendAttempts) {
      attempt += 1
      try {
        const config = await this.getConfig()
        const token = await this.getAccessToken(config)

        const keyDetails = await this.fetchKey(account, config, token)
        if (!this.isKeyUsable(keyDetails)) {
          this.logger.warn('[BreB] Invalid or mismatched key for account', { account })
          return { code: 'permanent', reason: 'missing_transaction_id', success: false }
        }

        const sendPayload = this.buildSendPayload(keyDetails, value)
        const sendResponse = await this.dispatchPayment(sendPayload, config, token)

        if (!sendResponse?.moviiTxId) {
          this.logger.error('[BreB] Send response missing transaction id', {
            responseData: this.sanitizeProviderPayload(sendResponse ?? null),
            responseRail: sendResponse?.rail ?? null,
          })
          return this.buildFailure('permanent', 'missing_transaction_id')
        }
        lastTransactionId = sendResponse.moviiTxId

        const resolvedRail = this.resolveRailForReport(sendResponse.rail, keyDetails.instructedAgent)
        if (!resolvedRail) {
          this.logger.error('[BreB] Unable to resolve rail for transaction status', {
            account,
            instructedAgent: keyDetails.instructedAgent,
            responseRail: sendResponse.rail ?? null,
            transactionId: sendResponse.moviiTxId,
          })
          return this.buildFailure('permanent', 'missing_rail', lastTransactionId)
        }

        const reportResult = await this.pollTransactionReport(sendResponse.moviiTxId, resolvedRail, config, token)
        const reportSummary = this.summarizeReport(reportResult?.report ?? null)
        if (reportResult?.result === 'success') {
          return { success: true, transactionId: sendResponse.moviiTxId }
        }

        if (reportResult?.result === 'pending') {
          this.logger.warn('[BreB] Payment pending after timeout', {
            rail: resolvedRail,
            report: reportSummary,
            transactionId: sendResponse.moviiTxId,
          })
          return { code: 'retriable', reason: 'pending', success: false, transactionId: sendResponse.moviiTxId }
        }

        if (reportResult?.result === 'failure') {
          this.logger.warn('[BreB] Payment rejected by provider', {
            rail: resolvedRail,
            report: reportSummary,
            transactionId: sendResponse.moviiTxId,
          })
        }
        else if (!reportResult) {
          this.logger.warn('[BreB] Payment status unavailable', {
            rail: resolvedRail,
            report: reportSummary,
            transactionId: sendResponse.moviiTxId,
          })
        }

        return this.buildFailure('permanent', reportResult?.result ?? 'unknown', lastTransactionId)
      }
      catch (error) {
        const reason = this.formatFailureReason(error)
        this.logger.error('[BreB] Payment submission failed', {
          account,
          attempt,
          reason,
          transactionId: lastTransactionId ?? null,
        })
        const code = this.extractFailureCode(error)
        const shouldRetry = code === 'retriable' && attempt < this.maxSendAttempts && this.isRetryableError(error)
        if (!shouldRetry) {
          return this.buildFailure(code, reason, lastTransactionId ?? undefined)
        }
        await this.sleep(this.retryDelayMs * attempt)
      }
    }

    return this.buildFailure('retriable', 'Maximum send attempts exceeded', lastTransactionId ?? undefined)
  }

  public async verifyAccount({
    account,
  }: {
    account: string
  }): Promise<boolean> {
    try {
      const config = await this.getConfig()
      const token = await this.getAccessToken(config)
      const keyDetails = await this.fetchKey(account, config, token)
      return this.isKeyUsable(keyDetails)
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn('[BreB] Failed to verify account', { account, reason })
      return false
    }
  }

  private buildCorrelationId(): string {
    // Movii's own example uses a 16-digit numeric id; keep the width exact
    // rather than sending a uuid the gateway may reject on length.
    const half = () => randomInt(0, 100_000_000).toString().padStart(8, '0')
    return `${half()}${half()}`
  }

  private buildFailure(code: PaymentFailureCode, reason?: string, transactionId?: null | string): PaymentSendResult {
    return {
      code,
      ...(reason ? { reason } : {}),
      success: false,
      ...(transactionId ? { transactionId } : {}),
    }
  }

  private buildHeaders(config: BrebServiceConfig, token: string, rail?: BrebRail): Record<string, string> {
    const headers: Record<string, string> = {
      'authorizationApi': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'dad-account': config.dadAccount,
      'x-forwarded': '192.168.1.1',
      'x-origin': 'miportal.web:8080',
      'x-product-code': config.productCode,
    }

    const normalizedRail = this.normalizeRail(rail)
    if (normalizedRail) {
      headers['x-rail'] = normalizedRail
    }

    return headers
  }

  private buildSendPayload(keyDetails: BrebKeyDetails, value: number): BrebSendPayload {
    const payload: BrebSendPayload = {
      creditor_account_number: keyDetails.accountNumber ?? '',
      creditor_document_number: keyDetails.documentNumber ?? '',
      creditor_document_type: keyDetails.documentType ?? '',
      creditor_entity_id: keyDetails.entityId ?? '',
      creditor_instructed_agent: keyDetails.instructedAgent ?? '',
      creditor_key_id: keyDetails.keyId ?? '',
      creditor_name: keyDetails.name ?? '',
      creditor_party_identifier: keyDetails.partyIdentifier ?? '',
      creditor_party_system_identifier: keyDetails.partySystemIdentifier ?? '',
      creditor_party_type: keyDetails.partyType ?? '',
      creditor_sub_type: keyDetails.subType ?? '',
      creditor_type_account: keyDetails.typeAccount ?? '',
      transaction_note: 'Abroad transfer',
      transaction_total_amount: Number(value),
    }

    if (keyDetails.merchantId) {
      payload['creditor_merchant_id'] = keyDetails.merchantId
    }

    return payload
  }

  private describeBalanceFields(data: unknown): null | string[] {
    const candidate = Array.isArray(data) ? data[0] : data
    if (!candidate || typeof candidate !== 'object') {
      return null
    }
    // Key names only — the values are balances, and this runs on the error path.
    return Object.keys(candidate as Record<string, unknown>)
  }

  private async dispatchPayment(
    payload: BrebSendPayload,
    config: BrebServiceConfig,
    token: string,
  ): Promise<BrebSendResponseData | null> {
    const endpoint = `${config.apiBaseUrl}/send`
    const headers = this.buildHeaders(config, token)
    const requestStartedAt = Date.now()

    this.logBrebRequest({
      endpoint,
      headers,
      metadata: {
        merchantIdPresent: Boolean(payload.creditor_merchant_id),
        rail: payload.creditor_instructed_agent,
        transactionTotalAmount: payload.transaction_total_amount,
      },
      method: 'POST',
      payload,
    })

    try {
      const response = await axios.post<BrebApiEnvelope<BrebSendResponseData>>(
        endpoint,
        payload,
        { headers },
      )
      this.logBrebResponse({
        endpoint,
        metadata: {
          durationMs: Date.now() - requestStartedAt,
          rail: payload.creditor_instructed_agent,
          transactionId: response.data?.data?.moviiTxId ?? null,
          ...(this.extractEnvelopeMetadata(response.data) ?? {}),
        },
        method: 'POST',
        responseData: response.data?.data ?? null,
        status: response.status,
      })
      return response.data?.data ?? null
    }
    catch (error) {
      this.logBrebError({
        endpoint,
        error,
        metadata: {
          durationMs: Date.now() - requestStartedAt,
          rail: payload.creditor_instructed_agent,
          transactionTotalAmount: payload.transaction_total_amount,
        },
        method: 'POST',
        operation: 'Failed to dispatch payment',
      })
      throw error
    }
  }

  private extractBalance(data: unknown): null | number {
    const candidate = Array.isArray(data) ? data[0] : data
    if (candidate === null || typeof candidate !== 'object') {
      return this.toFiniteNumber(candidate)
    }

    for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
      if (!this.balanceFieldNames.has(key.toLowerCase())) {
        continue
      }
      const parsed = this.toFiniteNumber(value)
      if (parsed !== null) {
        return parsed
      }
    }

    return null
  }

  private extractEnvelopeMetadata(envelope: BrebApiEnvelope<unknown> | null | undefined): null | {
    responseCode: null | string
    responseMessage: null | string
  } {
    if (!envelope || typeof envelope !== 'object') {
      return null
    }

    const responseCode = typeof envelope.code === 'string' ? envelope.code : null
    const responseMessage = typeof envelope.message === 'string' ? envelope.message : null
    if (!responseCode && !responseMessage) {
      return null
    }

    return { responseCode, responseMessage }
  }

  private extractErrorStatus(error: unknown): number | undefined {
    const maybeAxios = error as { response?: { status?: number } }
    return typeof maybeAxios?.response?.status === 'number' ? maybeAxios.response.status : undefined
  }

  private extractFailureCode(error: unknown): PaymentFailureCode {
    if (axios.isAxiosError(error)) {
      const status = this.extractErrorStatus(error)
      if (typeof status === 'number') {
        if (status >= 500) return 'retriable'
        if (status >= 400) return 'permanent'
      }
      return 'permanent'
    }

    return 'retriable'
  }

  private async fetchKey(
    account: string,
    config: BrebServiceConfig,
    token: string,
  ): Promise<BrebKeyDetails | null> {
    const endpoint = `${config.apiBaseUrl}/key/${encodeURIComponent(account)}`
    const headers = this.buildHeaders(config, token)
    const requestStartedAt = Date.now()

    this.logBrebRequest({
      endpoint,
      headers,
      metadata: {
        accountSuffix: this.maskIdentifier(account),
      },
      method: 'GET',
    })

    try {
      const response = await axios.get<BrebApiEnvelope<BrebKeyDetails>>(
        endpoint,
        { headers },
      )
      this.logBrebResponse({
        endpoint,
        metadata: {
          durationMs: Date.now() - requestStartedAt,
          hasKey: Boolean(response.data?.data),
          keyState: response.data?.data?.keyState ?? null,
          ...(this.extractEnvelopeMetadata(response.data) ?? {}),
        },
        method: 'GET',
        responseData: response.data.data,
        status: response.status,
      })

      if (!response.data?.data) {
        this.logger.warn('[BreB] Key lookup returned no data', { account })
        return null
      }
      return response.data.data
    }
    catch (error) {
      this.logBrebError({
        endpoint,
        error,
        metadata: {
          accountSuffix: this.maskIdentifier(account),
          durationMs: Date.now() - requestStartedAt,
        },
        method: 'GET',
        operation: 'Failed to fetch key',
      })
      return null
    }
  }

  private async fetchTransactionReport(
    transactionId: string,
    rail: BrebRail,
    config: BrebServiceConfig,
    token: string,
  ): Promise<BrebTransactionReport | null> {
    const endpoint = `${config.apiBaseUrl}/transaction-report/${encodeURIComponent(transactionId)}`
    const headers = this.buildHeaders(config, token, rail)
    const requestStartedAt = Date.now()

    this.logBrebRequest({
      endpoint,
      headers,
      metadata: {
        rail,
        transactionId: this.maskIdentifier(transactionId),
      },
      method: 'GET',
    })

    try {
      const response = await axios.get<BrebApiEnvelope<BrebTransactionReport>>(
        endpoint,
        { headers },
      )

      this.logBrebResponse({
        endpoint,
        metadata: {
          durationMs: Date.now() - requestStartedAt,
          rail,
          reportAvailable: Boolean(response.data?.data),
          ...(this.extractEnvelopeMetadata(response.data) ?? {}),
        },
        method: 'GET',
        responseData: response.data?.data ?? null,
        status: response.status,
      })

      return response.data?.data ?? null
    }
    catch (error) {
      this.logBrebError({
        endpoint,
        error,
        metadata: {
          durationMs: Date.now() - requestStartedAt,
          rail,
          transactionId: this.maskIdentifier(transactionId),
        },
        method: 'GET',
        operation: 'Failed to fetch transaction report',
      })
      return null
    }
  }

  private formatFailureReason(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.response?.data !== undefined) {
        if (typeof error.response.data === 'string') {
          return error.response.data
        }
        try {
          return JSON.stringify(error.response.data)
        }
        catch {
          return String(error.response.data)
        }
      }
      if (error.message) return error.message
      return 'Request failed'
    }

    if (error instanceof Error) {
      return error.message
    }
    try {
      return JSON.stringify(error)
    }
    catch {
      return 'Unknown error'
    }
  }

  private async getAccessToken(config: BrebServiceConfig): Promise<string> {
    const now = Date.now()
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > now) {
      return this.accessTokenCache.value
    }

    const data = await this.requestClientCredentialsToken(config, 'BreB authentication failed')
    const expiresAt = now + Math.max(data.expires_in - 30, 0) * 1000
    this.accessTokenCache = { expiresAt, value: data.access_token }
    return data.access_token
  }

  private async getConfig(): Promise<BrebServiceConfig> {
    if (this.serviceConfig) {
      return this.serviceConfig
    }

    const secrets = await this.secretManager.getSecrets([
      'BREB_API_BASE_URL',
      'BREB_AUTH_URL',
      'BREB_CLIENT_ID',
      'BREB_CLIENT_SECRET',
      'BREB_DAD_ACCOUNT',
      'BREB_PRODUCT_CODE',
    ] as const)

    this.serviceConfig = {
      apiBaseUrl: secrets.BREB_API_BASE_URL.replace(/\/$/, ''),
      authUrl: secrets.BREB_AUTH_URL,
      clientId: secrets.BREB_CLIENT_ID,
      clientSecret: secrets.BREB_CLIENT_SECRET,
      dadAccount: secrets.BREB_DAD_ACCOUNT,
      productCode: secrets.BREB_PRODUCT_CODE,
    }

    return this.serviceConfig
  }

  private async getMoviiBalanceAccessToken(config: MoviiBalanceConfig): Promise<string> {
    const now = Date.now()
    if (this.moviiBalanceTokenCache && this.moviiBalanceTokenCache.expiresAt > now) {
      return this.moviiBalanceTokenCache.value
    }

    const data = await this.requestClientCredentialsToken(config, 'Movii balance authentication failed')
    const expiresAt = now + Math.max(data.expires_in - 30, 0) * 1000
    this.moviiBalanceTokenCache = { expiresAt, value: data.access_token }
    return data.access_token
  }

  private async getMoviiBalanceConfig(): Promise<MoviiBalanceConfig> {
    if (this.moviiBalanceConfig) {
      return this.moviiBalanceConfig
    }

    const secrets = await this.secretManager.getSecrets([
      'MOVII_BALANCE_API_BASE_URL',
      'MOVII_BALANCE_AUTHORIZATION',
      'MOVII_BALANCE_AUTH_URL',
      'MOVII_BALANCE_CLIENT_ID',
      'MOVII_BALANCE_CLIENT_SECRET',
    ] as const)

    this.moviiBalanceConfig = {
      authorization: secrets.MOVII_BALANCE_AUTHORIZATION,
      authUrl: secrets.MOVII_BALANCE_AUTH_URL,
      clientId: secrets.MOVII_BALANCE_CLIENT_ID,
      clientSecret: secrets.MOVII_BALANCE_CLIENT_SECRET,
      endpoint: this.resolveMoviiBalanceEndpoint(secrets.MOVII_BALANCE_API_BASE_URL),
    }

    return this.moviiBalanceConfig
  }

  private hasValue(value: BrebKeyDetails[keyof BrebKeyDetails]): value is string {
    return typeof value === 'string' && value.trim().length > 0
  }

  private interpretReport(report: BrebTransactionReport): BrebTransactionOutcome {
    const statuses = [
      report.GlobalTransactionInfAndSts?.GlobalTxStatus,
      report.Debtor?.TransactionInfAndSts?.TransactionStatus,
      report.Creditor?.TransactionInfAndSts?.TransactionStatus,
    ]
      .filter((value): value is string => Boolean(value))
      .map(value => value.toUpperCase())

    if (statuses.some(status => status.startsWith('RJ') || status === 'CANC')) {
      return 'failure'
    }

    if (statuses.some(status => status === 'ACCP' || status === 'ACSC')) {
      return 'success'
    }

    return 'pending'
  }

  private isCustomerInputResponseCode(responseCode: null | string | undefined): boolean {
    return typeof responseCode === 'string'
      && this.customerInputResponseCodes.has(responseCode.toUpperCase())
  }

  private isKeyUsable(keyDetails: BrebKeyDetails | null): keyDetails is BrebKeyDetails & { instructedAgent: BrebRail } {
    if (!keyDetails) {
      return false
    }

    const isActive = keyDetails.keyState?.toUpperCase() === 'ACTIVA' || keyDetails.keyState?.toUpperCase() === 'ACTIVE'
    const missingFields = this.mandatoryKeyFields.filter(field => !this.hasValue(keyDetails[field]))

    if (missingFields.length > 0) {
      this.logger.warn('[BreB] Key missing required attributes', { missingFields })
      return false
    }

    return isActive
  }

  private isRetryableError(error: unknown): boolean {
    const status = this.extractErrorStatus(error)
    if (typeof status === 'number') {
      return status >= 500
    }
    return false
  }

  private logBrebError({
    endpoint,
    error,
    metadata,
    method,
    operation,
  }: {
    endpoint: string
    error: unknown
    metadata?: Record<string, boolean | null | number | string | undefined>
    method: 'GET' | 'POST'
    operation: string
  }): void {
    if (axios.isAxiosError(error)) {
      const envelopeMetadata = this.extractEnvelopeMetadata(error.response?.data)
      const payload = {
        endpoint: this.sanitizeUrlForLogs(endpoint),
        message: error.message,
        method,
        responseData: this.sanitizeProviderPayload(error.response?.data ?? null),
        ...(envelopeMetadata ? { responseCode: envelopeMetadata.responseCode, responseMessage: envelopeMetadata.responseMessage } : {}),
        status: error.response?.status ?? null,
        ...(metadata ? { metadata } : {}),
      }
      if (this.isCustomerInputResponseCode(envelopeMetadata?.responseCode)) {
        this.logger.warn(`[BreB] ${operation}`, payload)
        return
      }
      this.logger.error(`[BreB] ${operation}`, payload)
      return
    }

    const fallbackMessage = error instanceof Error ? error.message : 'Unknown error'
    this.logger.error(`[BreB] ${operation}`, {
      endpoint: this.sanitizeUrlForLogs(endpoint),
      message: fallbackMessage,
      method,
      ...(metadata ? { metadata } : {}),
    })
  }

  private logBrebRequest({
    endpoint,
    headers,
    metadata,
    method,
    payload,
  }: {
    endpoint: string
    headers: Record<string, string>
    metadata?: Record<string, boolean | null | number | string | undefined>
    method: 'GET' | 'POST'
    payload?: unknown
  }): void {
    this.logger.info('[BreB] Outbound request', {
      endpoint: this.sanitizeUrlForLogs(endpoint),
      headers: this.redactHeaders(headers),
      method,
      ...(metadata ? { metadata } : {}),
      ...(payload === undefined ? {} : { payload: this.sanitizeProviderPayload(payload) }),
    })
  }

  private logBrebResponse({
    endpoint,
    metadata,
    method,
    responseData,
    status,
  }: {
    endpoint: string
    metadata?: Record<string, boolean | null | number | string | undefined>
    method: 'GET' | 'POST'
    responseData?: unknown
    status: number
  }): void {
    this.logger.info('[BreB] Response received', {
      endpoint: this.sanitizeUrlForLogs(endpoint),
      method,
      status,
      ...(responseData === undefined ? {} : { responseData: this.sanitizeProviderPayload(responseData) }),
      ...(metadata ? { metadata } : {}),
    })
  }

  private maskIdentifier(value: null | string | undefined): string {
    if (!value) {
      return '<empty>'
    }

    const trimmed = value.trim()
    if (trimmed.length <= 4) {
      return '***'
    }

    const visibleSuffix = trimmed.slice(-4)
    const maskedPrefixLength = Math.min(Math.max(trimmed.length - 4, 3), 12)
    return `${'*'.repeat(maskedPrefixLength)}${visibleSuffix}`
  }

  private normalizeRail(value: unknown): null | string {
    if (typeof value !== 'string') {
      return null
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private normalizeResponseCode(value: unknown): null | string {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : null
    }
    if (typeof value !== 'string') {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private async pollTransactionReport(
    transactionId: string,
    rail: BrebRail,
    config: BrebServiceConfig,
    token: string,
  ): Promise<null | { report: BrebTransactionReport | null, result: BrebTransactionOutcome }> {
    const start = Date.now()
    let lastReport: BrebTransactionReport | null = null

    while (Date.now() - start < this.pollConfig.timeoutMs) {
      const report = await this.fetchTransactionReport(transactionId, rail, config, token)
      lastReport = report

      if (report) {
        const outcome = this.interpretReport(report)
        if (outcome !== 'pending') {
          return { report, result: outcome }
        }
      }

      await new Promise(resolve => setTimeout(resolve, this.pollConfig.delayMs))
    }

    return lastReport ? { report: lastReport, result: this.interpretReport(lastReport) } : null
  }

  private readNumberFromEnv(envKey: string, fallback: number): number {
    const raw = process.env[envKey]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private redactHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHints = ['authorization', 'secret', 'token']
    return Object.entries(headers).reduce<Record<string, string>>((sanitized, [key, value]) => {
      const normalizedKey = key.toLowerCase()
      const shouldRedact = sensitiveHints.some(hint => normalizedKey.includes(hint))
      sanitized[key] = shouldRedact ? '<redacted>' : value
      return sanitized
    }, {})
  }

  /**
   * Shared client_credentials exchange. Both Movii OAuth clients (Bre-B payments
   * and BTB balance) speak the same grant against different hosts, so the wire
   * format lives here and the callers own only their own token cache.
   */
  private async requestClientCredentialsToken(
    config: { authUrl: string, clientId: string, clientSecret: string },
    failureMessage: string,
  ): Promise<BrebTokenResponse> {
    const params = new URLSearchParams()
    params.append('grant_type', 'client_credentials')

    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    const requestStartedAt = Date.now()
    const headers = {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    this.logBrebRequest({
      endpoint: config.authUrl,
      headers,
      metadata: {
        grantType: 'client_credentials',
      },
      method: 'POST',
      payload: {
        grant_type: 'client_credentials',
      },
    })
    try {
      const response = await axios.post<BrebTokenResponse>(
        config.authUrl,
        params,
        { headers },
      )
      const data = response.data
      this.logBrebResponse({
        endpoint: config.authUrl,
        metadata: {
          durationMs: Date.now() - requestStartedAt,
          tokenReceived: Boolean(data?.access_token),
          tokenTtlSeconds: data?.expires_in ?? null,
        },
        method: 'POST',
        status: response.status,
      })
      return data
    }
    catch (error) {
      this.logBrebError({
        endpoint: config.authUrl,
        error,
        metadata: {
          durationMs: Date.now() - requestStartedAt,
        },
        method: 'POST',
        operation: 'Failed to obtain access token',
      })
      throw error instanceof Error ? error : new Error(failureMessage)
    }
  }

  private async requestMoviiBalance(config: MoviiBalanceConfig, token: string): Promise<MoviiBalanceEnvelope> {
    const endpoint = config.endpoint
    const correlationId = this.buildCorrelationId()
    // Both auth headers are mandatory per the spec's business-service header
    // table: `authorizationApi` carries the OAuth2 bearer, `authorization`
    // the static credential Movii issues per subscriber.
    const headers: Record<string, string> = {
      'authorization': config.authorization,
      'authorizationApi': `Bearer ${token}`,
      'Content-Type': 'text/plain',
      'correlationid': correlationId,
    }
    const requestStartedAt = Date.now()

    this.logBrebRequest({
      endpoint,
      headers,
      metadata: { correlationId },
      method: 'GET',
    })

    try {
      const { data, status } = await axios.get<MoviiBalanceEnvelope>(endpoint, {
        headers,
        timeout: this.liquidityRequestTimeoutMs,
      })
      this.logBrebResponse({
        endpoint,
        metadata: {
          correlationId,
          durationMs: Date.now() - requestStartedAt,
          // Movii mints its own id per response; keep it for support tickets.
          providerCorrelationId: data?.correlationId ?? null,
          responseCode: this.normalizeResponseCode(data?.code),
          responseMessage: data?.message ?? null,
        },
        method: 'GET',
        status,
      })
      this.liquidityRateLimitedUntilMs = 0
      return data ?? {}
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      const status = this.extractErrorStatus(error)
      if (status === 429) {
        this.liquidityRateLimitedUntilMs = Date.now() + this.liquidityRateLimitCooldownMs
      }
      this.logger.error('[BreB] Error fetching liquidity', {
        correlationId,
        reason,
        ...(typeof status === 'number' ? { status } : {}),
        ...(status === 429 ? { cooldownMs: this.liquidityRateLimitCooldownMs } : {}),
        responseData: this.sanitizeProviderPayload(
          axios.isAxiosError(error) ? (error.response?.data ?? null) : null,
        ),
      })
      throw error instanceof Error ? error : new Error(reason)
    }
  }

  /**
   * Movii fronts this service with an OCI API Gateway whose deployment path is
   * environment-specific and bears no relation to the internal route in the
   * spec (the spec's path is the in-cluster one from its dev example). So when
   * the configured URL already names the operation, it *is* the endpoint;
   * only a bare origin gets the documented path appended.
   */
  private resolveMoviiBalanceEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/$/, '')
    return trimmed.endsWith('/get-balance') ? trimmed : `${trimmed}${this.moviiBalancePath}`
  }

  private resolveRailForReport(responseRail: unknown, instructedAgent: null | string | undefined): null | string {
    const normalizedResponseRail = this.normalizeRail(responseRail)
    if (normalizedResponseRail) {
      return normalizedResponseRail
    }

    const normalizedKeyRail = this.normalizeRail(instructedAgent)
    if (normalizedKeyRail) {
      if (responseRail !== undefined && responseRail !== null) {
        this.logger.warn('[BreB] Send response rail unusable, defaulting to instructed agent', {
          instructedAgent,
          responseRail,
        })
      }
      return normalizedKeyRail
    }

    this.logger.error('[BreB] Unable to resolve rail for transaction status polling', {
      instructedAgent: instructedAgent ?? null,
      responseRail: responseRail ?? null,
    })
    return null
  }

  private sanitizeProviderPayload(payload: unknown): unknown {
    const visited = new WeakSet<object>()
    const redactKeys = new Set([
      'authorization',
      'clientsecret',
      'password',
      'secret',
      'token',
    ])
    const maskKeys = new Set([
      'account',
      'accountnumber',
      'documentnumber',
      'keyid',
      'partyidentifier',
      'partysystemidentifier',
      'transactiondirectoryid',
    ])

    const shouldRedact = (key: string) => {
      const normalized = key.toLowerCase()
      return Array.from(redactKeys).some(entry => normalized.includes(entry))
    }

    const shouldMask = (key: string) => maskKeys.has(key.toLowerCase())

    const sanitize = (value: unknown, key?: string): unknown => {
      if (value === null || value === undefined) return value
      if (typeof value === 'string') {
        if (key && shouldMask(key)) {
          return this.maskIdentifier(value)
        }
        return value
      }
      if (typeof value !== 'object') return value
      if (Array.isArray(value)) {
        return value.map(entry => sanitize(entry))
      }

      if (visited.has(value)) {
        return '[Circular]'
      }
      visited.add(value)

      const record = value as Record<string, unknown>
      const sanitized: Record<string, unknown> = {}
      for (const [childKey, childValue] of Object.entries(record)) {
        if (shouldRedact(childKey)) {
          sanitized[childKey] = '<redacted>'
          continue
        }
        sanitized[childKey] = sanitize(childValue, childKey)
      }
      return sanitized
    }

    return sanitize(payload)
  }

  private sanitizeUrlForLogs(url: string): string {
    try {
      const parsedUrl = new URL(url)
      const sanitizedPath = parsedUrl.pathname
        .split('/')
        .map(segment => (this.shouldMaskPathSegment(segment) ? this.maskIdentifier(segment) : segment))
        .join('/')
      return `${parsedUrl.origin}${sanitizedPath}`
    }
    catch {
      return url
    }
  }

  private shouldMaskPathSegment(segment: string): boolean {
    if (!segment) {
      return false
    }

    const normalized = segment.trim()
    return /^\d+$/.test(normalized) || normalized.length >= 16
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  private summarizeReport(report: BrebTransactionReport | null): null | Record<string, unknown> {
    if (!report) return null
    const debtor = report.Debtor?.TransactionInfAndSts
    const creditor = report.Creditor?.TransactionInfAndSts
    const global = report.GlobalTransactionInfAndSts

    const responseCodes = [debtor?.ResponseCode, creditor?.ResponseCode]
      .filter((value): value is string => Boolean(value))
    const reasons = [debtor?.TransactionStatusRsnInf, creditor?.TransactionStatusRsnInf]
      .filter((value): value is string => Boolean(value))

    return {
      amount: global?.OriginalCtrlSumAmt ?? null,
      creditorStatus: creditor?.TransactionStatus ?? null,
      currency: global?.Currency ?? null,
      debtorStatus: debtor?.TransactionStatus ?? null,
      globalStatus: global?.GlobalTxStatus ?? null,
      reason: reasons.length > 0 ? reasons : null,
      responseCodes: responseCodes.length > 0 ? responseCodes : null,
      timestamp: global?.TransactionDateTime ?? null,
      transactionDirectoryId: report.TransactionDirectoryId ?? null,
      transactionId: report.TransactionID ?? null,
    }
  }

  private toFiniteNumber(value: unknown): null | number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }
    if (typeof value !== 'string') {
      return null
    }

    const trimmed = value.trim()
    // A grouped string like "1.234.567,89" parses to 1.234 — a thousand-fold
    // under-read of the float that would silently reject every COP payout.
    // Refuse anything that isn't a plain decimal rather than guess the locale.
    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return null
    }

    const parsed = Number.parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
}
