import { TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject, injectable } from 'inversify'

import { ILogger } from '../../interfaces'
import { IPaymentService } from '../../interfaces/IPaymentService'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

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
  instructedAgent?: BrebRail
  keyId?: string
  keyState?: string
  merchantId?: null | string
  name?: string
  partyIdentifier?: string
  partySystemIdentifier?: string
  partyType?: string
  subType?: string
  typeAccount?: string
}

type BrebRail = 'ENT' | 'TFY'

type BrebRailOption = {
  bankCode: number
  bankName: string
  rail: BrebRail
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

const railOptions: readonly BrebRailOption[] = [
  { bankCode: 9101, bankName: 'BreB - Entre Cuentas (ENT)', rail: 'ENT' },
  { bankCode: 9102, bankName: 'BreB - Transfiya (TFY)', rail: 'TFY' },
]

@injectable()
export class BrebPaymentService implements IPaymentService {
  public readonly banks = railOptions.map(option => ({ bankCode: option.bankCode, bankName: option.bankName }))
  public readonly currency = TargetCurrency.COP
  public readonly fixedFee = 0

  public readonly isAsync = false
  public readonly isEnabled = false

  public readonly MAX_TOTAL_AMOUNT_PER_DAY = 25_000_000
  public readonly MAX_USER_AMOUNT_PER_DAY = 25_000_000
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION = 5_000_000
  public readonly MAX_USER_TRANSACTIONS_PER_DAY = 15

  public readonly percentageFee = 0

  private accessTokenCache?: { expiresAt: number, value: string }

  private readonly mandatoryKeyFields: ReadonlyArray<keyof BrebKeyDetails> = [
    'accountNumber',
    'documentNumber',
    'documentType',
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

  private readonly railByCode: Map<string, BrebRail>
  private serviceConfig?: BrebServiceConfig

  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    this.railByCode = new Map(railOptions.map(option => [String(option.bankCode), option.rail]))
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
    bankCode,
    value,
  }: {
    account: string
    bankCode: string
    id: string
    qrCode?: null | string
    value: number
  }): Promise<{ success: false } | { success: true, transactionId: string }> {
    try {
      const resolvedRail = this.resolveRail(bankCode)
      const config = await this.getConfig()
      const token = await this.getAccessToken(config)

      const keyDetails = await this.fetchKey(account, config, token)
      if (!this.isKeyUsable(keyDetails, resolvedRail)) {
        this.logger.warn('[BreB] Invalid or mismatched key for account', { account, bankCode })
        return { success: false }
      }

      const sendPayload = this.buildSendPayload(keyDetails, value)
      const sendResponse = await this.dispatchPayment(sendPayload, config, token)

      if (!sendResponse?.moviiTxId) {
        this.logger.error('[BreB] Send response missing transaction id', sendResponse)
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
      this.logger.error('[BreB] Payment submission failed', { account, bankCode, reason })
      return { success: false }
    }
  }

  public async verifyAccount({
    account,
    bankCode,
  }: {
    account: string
    bankCode: string
  }): Promise<boolean> {
    try {
      const resolvedRail = this.resolveRail(bankCode)
      const config = await this.getConfig()
      const token = await this.getAccessToken(config)
      const keyDetails = await this.fetchKey(account, config, token)
      return this.isKeyUsable(keyDetails, resolvedRail)
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn('[BreB] Failed to verify account', { account, bankCode, reason })
      return false
    }
  }

  private buildHeaders(config: BrebServiceConfig, token: string, rail?: BrebRail): Record<string, string> {
    const headers: Record<string, string> = {
      'authorizationApi': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'dad-account': config.dadAccount,
      'x-product-code': config.productCode,
    }

    if (rail) {
      headers['x-rail'] = rail
    }

    return headers
  }

  private buildSendPayload(keyDetails: BrebKeyDetails, value: number): Record<string, number | string> {
    const payload: Record<string, number | string> = {
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
    payload: Record<string, number | string>,
    config: BrebServiceConfig,
    token: string,
  ): Promise<BrebSendResponseData | null> {
    try {
      const { data } = await axios.post<BrebApiEnvelope<BrebSendResponseData>>(
        `${config.apiBaseUrl}/send`,
        payload,
        { headers: this.buildHeaders(config, token) },
      )
      return data?.data ?? null
    }
    catch (error) {
      const reason = axios.isAxiosError(error) ? error.response?.data ?? error.message : error
      this.logger.error('[BreB] Failed to dispatch payment', reason)
      return null
    }
  }

  private async fetchKey(
    account: string,
    config: BrebServiceConfig,
    token: string,
  ): Promise<BrebKeyDetails | null> {
    try {
      const { data } = await axios.get<BrebApiEnvelope<BrebKeyDetails>>(
        `${config.apiBaseUrl}/key/${encodeURIComponent(account)}`,
        { headers: this.buildHeaders(config, token) },
      )

      if (!data?.data) {
        this.logger.warn('[BreB] Key lookup returned no data', { account })
        return null
      }
      return data.data
    }
    catch (error) {
      const reason = axios.isAxiosError(error) ? error.response?.data ?? error.message : error
      this.logger.error('[BreB] Failed to fetch key', reason)
      return null
    }
  }

  private async fetchTransactionReport(
    transactionId: string,
    rail: BrebRail,
    config: BrebServiceConfig,
    token: string,
  ): Promise<BrebTransactionReport | null> {
    try {
      const { data } = await axios.get<BrebApiEnvelope<BrebTransactionReport>>(
        `${config.apiBaseUrl}/transaction-report/${encodeURIComponent(transactionId)}`,
        { headers: this.buildHeaders(config, token, rail) },
      )

      return data?.data ?? null
    }
    catch (error) {
      const reason = axios.isAxiosError(error) ? error.response?.data ?? error.message : error
      this.logger.error('[BreB] Failed to fetch transaction report', reason)
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

    try {
      const { data } = await axios.post<BrebTokenResponse>(
        config.authUrl,
        params,
        {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      )

      const expiresAt = now + Math.max(data.expires_in - 30, 0) * 1000
      this.accessTokenCache = { expiresAt, value: data.access_token }
      return data.access_token
    }
    catch (error) {
      const reason = axios.isAxiosError(error) ? error.response?.data ?? error.message : error
      this.logger.error('[BreB] Failed to obtain access token', reason)
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

  private isKeyUsable(keyDetails: BrebKeyDetails | null, rail: BrebRail): keyDetails is BrebKeyDetails {
    if (!keyDetails) {
      return false
    }

    const isActive = keyDetails.keyState?.toUpperCase() === 'ACTIVA' || keyDetails.keyState?.toUpperCase() === 'ACTIVE'
    const matchesRail = keyDetails.instructedAgent?.toUpperCase() === rail
    const missingFields = this.mandatoryKeyFields.filter(field => !this.hasValue(keyDetails[field]))

    if (missingFields.length > 0) {
      this.logger.warn('[BreB] Key missing required attributes', { missingFields })
      return false
    }

    return isActive && matchesRail
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

  private resolveRail(bankCode: string): BrebRail {
    const normalized = bankCode.trim().toUpperCase()
    if (normalized === 'ENT' || normalized === 'TFY') {
      return normalized
    }

    const mappedRail = this.railByCode.get(bankCode) || this.railByCode.get(normalized)
    if (mappedRail) {
      return mappedRail
    }

    throw new Error(`Unsupported BreB rail or bank code: ${bankCode}`)
  }
}
