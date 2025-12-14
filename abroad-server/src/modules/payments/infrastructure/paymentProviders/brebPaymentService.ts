import { TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IPaymentService } from '../../application/contracts/IPaymentService'

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

type BrebRail = 'ENT' | 'TFY'

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

@injectable()
export class BrebPaymentService implements IPaymentService {
  public readonly banks = []
  public readonly currency = TargetCurrency.COP
  public readonly fixedFee = 0

  public readonly isAsync = false
  public readonly isEnabled = true

  public readonly MAX_TOTAL_AMOUNT_PER_DAY = 25_000_000
  public readonly MAX_USER_AMOUNT_PER_DAY = 25_000_000
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION = 5_000_000
  public readonly MAX_USER_TRANSACTIONS_PER_DAY = 15

  public readonly MIN_USER_AMOUNT_PER_TRANSACTION = 5_000

  public readonly percentageFee = 0

  private accessTokenCache?: { expiresAt: number, value: string }

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

  private readonly pollConfig = {
    delayMs: 2_000,
    timeoutMs: 60_000,
  }

  private serviceConfig?: BrebServiceConfig

  private readonly supportedRails: ReadonlyArray<BrebRail> = ['ENT', 'TFY']

  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
  }

  public async getLiquidity(): Promise<number> {
    // BreB does not expose liquidity; use method-level limit as a conservative estimate.
    return this.MAX_TOTAL_AMOUNT_PER_DAY
  }

  public async onboardUser(): Promise<{ message?: string, success: boolean }> {
    return { message: 'BreB does not require explicit onboarding', success: true }
  }

  public async sendPayment({
    account,
    value,
  }: {
    account: string
    bankCode?: string
    id: string
    qrCode?: null | string
    value: number
  }): Promise<{ success: false } | { success: true, transactionId: string }> {
    try {
      const config = await this.getConfig()
      const token = await this.getAccessToken(config)

      const keyDetails = await this.fetchKey(account, config, token)
      if (!this.isKeyUsable(keyDetails)) {
        this.logger.warn('[BreB] Invalid or mismatched key for account', { account })
        return { success: false }
      }

      const sendPayload = this.buildSendPayload(keyDetails, value)
      const sendResponse = await this.dispatchPayment(sendPayload, config, token)

      if (!sendResponse?.moviiTxId) {
        this.logger.error('[BreB] Send response missing transaction id', sendResponse)
        return { success: false }
      }

      const resolvedRail = keyDetails.instructedAgent
      if (!resolvedRail) {
        this.logger.error('[BreB] Missing instructed agent on key details', { account })
        return { success: false }
      }

      const reportResult = await this.pollTransactionReport(sendResponse.moviiTxId, resolvedRail, config, token)
      if (reportResult?.result === 'success') {
        return { success: true, transactionId: sendResponse.moviiTxId }
      }

      if (reportResult?.result === 'pending') {
        this.logger.warn('[BreB] Payment pending after timeout', { transactionId: sendResponse.moviiTxId })
      }

      return { success: false }
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error('[BreB] Payment submission failed', { account, reason })
      return { success: false }
    }
  }

  public async verifyAccount({
    account,
  }: {
    account: string
    bankCode?: string
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

  private buildHeaders(config: BrebServiceConfig, token: string, rail?: BrebRail): Record<string, string> {
    const headers: Record<string, string> = {
      'authorizationApi': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'dad-account': config.dadAccount,
      'x-forwarded': '192.168.1.1',
      'x-origin': 'miportal.web:8080',
      'x-product-code': config.productCode,
    }

    if (rail) {
      headers['x-rail'] = rail
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
        },
        method: 'POST',
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
      return null
    }
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
        },
        method: 'GET',
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

  private async getAccessToken(config: BrebServiceConfig): Promise<string> {
    const now = Date.now()
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > now) {
      return this.accessTokenCache.value
    }

    const params = new URLSearchParams()
    params.append('grant_type', 'client_credentials')

    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    const requestStartedAt = Date.now()

    this.logBrebRequest({
      endpoint: config.authUrl,
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
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
        {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
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

      const expiresAt = now + Math.max(data.expires_in - 30, 0) * 1000
      this.accessTokenCache = { expiresAt, value: data.access_token }
      return data.access_token
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
      throw new Error('BreB authentication failed')
    }
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

    if (!this.isSupportedRail(keyDetails.instructedAgent)) {
      this.logger.warn('[BreB] Unsupported rail for key', { rail: keyDetails.instructedAgent ?? '<empty>' })
      return false
    }

    return isActive
  }

  private isSupportedRail(rail: unknown): rail is BrebRail {
    return typeof rail === 'string' && this.supportedRails.includes(rail as BrebRail)
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
      this.logger.error(`[BreB] ${operation}`, {
        endpoint: this.sanitizeUrlForLogs(endpoint),
        message: error.message,
        method,
        responseData: error.response?.data ?? null,
        status: error.response?.status ?? null,
        ...(metadata ? { metadata } : {}),
      })
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
      ...(payload === undefined ? {} : { payload }),
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
      ...(responseData === undefined ? {} : { responseData }),
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

  private redactHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHints = ['authorization', 'secret', 'token']
    return Object.entries(headers).reduce<Record<string, string>>((sanitized, [key, value]) => {
      const normalizedKey = key.toLowerCase()
      const shouldRedact = sensitiveHints.some(hint => normalizedKey.includes(hint))
      sanitized[key] = shouldRedact ? '<redacted>' : value
      return sanitized
    }, {})
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
}
