import { PaymentMethod, TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IPaymentService, PaymentFailureCode, PaymentSendResult } from '../../application/contracts/IPaymentService'
import { IPixQrDecoder } from '../../application/contracts/IQrDecoder'

type TransactionTransfero = {
  payments?: TransferoPayment[]
}

type TransferoBalanceResponse = {
  balance?: {
    amount?: number | string
    currency?: string
  }
}

type TransferoConfig = {
  accountId: string
  baseUrl: string
}

type TransferoPayment = {
  amount: number
  currency: string
  name: string
  paymentId?: string
  pixKey?: string
  qrCode?: string
  taxId: string
  taxIdCountry: string
}

@injectable()
export class TransferoPaymentService implements IPaymentService {
  public readonly capability = {
    method: PaymentMethod.PIX,
    targetCurrency: TargetCurrency.BRL,
  }

  public readonly currency: TargetCurrency = TargetCurrency.BRL
  public readonly fixedFee = 0.0
  public readonly isAsync = true
  public readonly isEnabled = true

  public readonly MAX_TOTAL_AMOUNT_PER_DAY = Number.POSITIVE_INFINITY
  public readonly MAX_USER_AMOUNT_PER_DAY = Number.POSITIVE_INFINITY
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION = Number.POSITIVE_INFINITY
  public readonly MAX_USER_TRANSACTIONS_PER_DAY = Number.POSITIVE_INFINITY
  public readonly MIN_USER_AMOUNT_PER_TRANSACTION = 0

  public readonly percentageFee = 0.0
  public readonly provider = 'transfero'
  private readonly brazilDdds = new Set([
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46',
    '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99',
  ])

  private cachedToken?: { exp: number, value: string }

  private readonly maxSendAttempts: number

  private readonly retryDelayMs: number
  private readonly transferCurrency = 'BRL'

  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider) private databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPixQrDecoder) private pixQrDecoder: IPixQrDecoder,
    @inject(TYPES.ILogger) private logger: ILogger,
  ) {
    this.maxSendAttempts = this.readNumberFromEnv('TRANSFERO_MAX_SEND_ATTEMPTS', 3)
    this.retryDelayMs = this.readNumberFromEnv('TRANSFERO_RETRY_DELAY_MS', 250)
  }

  private static parseAmount(raw: number | string | undefined): null | number {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim()

      const direct = Number(trimmed)
      if (Number.isFinite(direct)) {
        return direct
      }

      const normalised = Number(trimmed.replace(/\./g, '').replace(',', '.'))
      if (Number.isFinite(normalised)) {
        return normalised
      }
    }

    return null
  }

  public getLiquidity: () => Promise<number> = async () => {
    try {
      const [token, config] = await Promise.all([
        this.getAccessToken(),
        this.getTransferoConfig(),
      ])

      const { data } = await axios.get<TransferoBalanceResponse>(
        `${config.baseUrl}/api/v2.0/accounts/${config.accountId}/balance`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      )

      const liquidity = this.extractLiquidityFromBalance(data, this.transferCurrency)

      if (liquidity !== null) {
        return liquidity
      }

      this.logger.warn('Transfero getLiquidity unexpected payload', {
        balance: data?.balance,
        expectedCurrency: this.transferCurrency,
      })
      return 0
    }
    catch (error) {
      this.logger.error('Transfero getLiquidity error:', this.formatAxiosError(error))
      return 0
    }
  }

  public onboardUser(): Promise<{ message?: string, success: boolean }> {
    throw new Error('Method not implemented for this payment service.')
  }

  public async sendPayment({
    account,
    id,
    qrCode,
    value,
  }: {
    account: string
    id: string
    qrCode?: null | string
    value: number
  }): Promise<PaymentSendResult> {
    let attempt = 0
    while (attempt < this.maxSendAttempts) {
      attempt += 1
      try {
        const [taxId, token, config] = await Promise.all([
          this.getTransactionTaxId(id),
          this.getAccessToken(),
          this.getTransferoConfig(),
        ])

        const contract = await this.buildContract({ account, qrCode, taxId, value })

        const response = await axios.post<TransactionTransfero>(
          `${config.baseUrl}/api/v2.0/accounts/${config.accountId}/paymentgroup`,
          contract,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        )
        const data = response?.data ?? response

        const paymentId = this.extractPaymentId(data)
        return paymentId
          ? { success: true, transactionId: paymentId }
          : this.buildFailure('permanent', 'paymentId_missing')
      }
      catch (error) {
        const formatted = this.formatAxiosError(error)
        const code = this.extractFailureCode(error)
        this.logger.error('Transfero sendPayment error:', formatted)

        const shouldRetry = code === 'retriable' && attempt < this.maxSendAttempts && this.isRetryableError(error)
        if (!shouldRetry) {
          return this.buildFailure(code, formatted)
        }

        await this.sleep(this.retryDelayMs * attempt)
      }
    }

    return this.buildFailure('retriable', 'Maximum send attempts exceeded')
  }

  public verifyAccount({ account }: { account: string }): Promise<boolean> {
    return Promise.resolve(Boolean(account))
  }

  private async buildContract({
    account,
    qrCode,
    taxId,
    value,
  }: {
    account: string
    qrCode?: null | string
    taxId: string
    value: number
  }): Promise<TransferoPayment[]> {
    if (qrCode) {
      const decoded = await this.pixQrDecoder.decode(qrCode)
      return [this.buildQrPayment({ decodedName: decoded?.name, qrCode, taxId: decoded?.taxId ?? taxId, value })]
    }

    return [this.buildPixPayment({ account, taxId, value })]
  }

  private buildFailure(code: PaymentFailureCode, reason?: string): PaymentSendResult {
    return { code, reason, success: false }
  }

  private buildPixKey(account: string): string {
    const normalizedBrazilPhone = this.normalizeBrazilPhoneNumber(account)
    return normalizedBrazilPhone ? `+55${normalizedBrazilPhone}` : account
  }

  private buildPixPayment(params: { account: string, taxId: string, value: number }): TransferoPayment {
    const pixKey = this.buildPixKey(params.account)
    return {
      amount: params.value,
      currency: this.transferCurrency,
      name: 'Recipient',
      pixKey,
      taxId: params.taxId,
      taxIdCountry: 'BRA',
    }
  }

  private buildQrPayment(params: { decodedName?: string, qrCode: string, taxId: string, value: number }): TransferoPayment {
    return {
      amount: params.value,
      currency: this.transferCurrency,
      name: params.decodedName || 'Recipient',
      qrCode: params.qrCode,
      taxId: params.taxId,
      taxIdCountry: 'BRA',
    }
  }

  private extractFailureCode(error: unknown): PaymentFailureCode {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      if (status && status >= 400 && status < 500) {
        return 'permanent'
      }
    }
    return 'retriable'
  }

  private extractLiquidityFromBalance(
    response: TransferoBalanceResponse,
    expectedCurrency: string,
  ): null | number {
    const amount = TransferoPaymentService.parseAmount(response?.balance?.amount)
    if (amount === null) return null

    const currency = response?.balance?.currency
    if (currency && currency.toUpperCase() !== expectedCurrency.toUpperCase()) return null

    return amount
  }

  private extractPaymentId(response: TransactionTransfero): null | string {
    const payment = response?.payments?.[0]
    const paymentId = payment?.paymentId
    return typeof paymentId === 'string' && paymentId.length > 0 ? paymentId : null
  }

  private formatAxiosError(error: unknown): string {
    const isAxiosError = axios.isAxiosError(error)
    const payload = isAxiosError
      ? error.response?.data ?? error.message
      : error instanceof Error
        ? error.message
        : error

    if (isAxiosError) {
      return typeof payload === 'string' ? JSON.stringify(payload) : JSON.stringify(payload)
    }

    return typeof payload === 'string' ? payload : JSON.stringify(payload)
  }

  /** OAuth2 client-credentials flow */
  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && now < this.cachedToken.exp - 60_000) {
      return this.cachedToken.value
    }

    const {
      TRANSFERO_BASE_URL: apiUrl,
      TRANSFERO_CLIENT_ID: clientId,
      TRANSFERO_CLIENT_SCOPE: clientScope,
      TRANSFERO_CLIENT_SECRET: clientSecret,
    } = await this.secretManager.getSecrets([
      'TRANSFERO_BASE_URL',
      'TRANSFERO_CLIENT_ID',
      'TRANSFERO_CLIENT_SCOPE',
      'TRANSFERO_CLIENT_SECRET',
    ])

    const { data } = await axios.post(`${apiUrl}/auth/token`, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: clientScope,
    }, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const value = data.access_token ?? data
    const seconds = Number(data.expires_in ?? 900)
    this.cachedToken = { exp: now + seconds * 1000, value }

    return value
  }

  private async getTransactionTaxId(transactionId: string): Promise<string> {
    const dbClient = await this.databaseClientProvider.getClient()
    const transaction = await dbClient.transaction.findUnique({
      select: { taxId: true },
      where: { id: transactionId },
    })

    if (!transaction?.taxId) {
      throw new Error('Partner user not found or tax ID is missing.')
    }

    return transaction.taxId
  }

  private async getTransferoConfig(): Promise<TransferoConfig> {
    const { TRANSFERO_ACCOUNT_ID, TRANSFERO_BASE_URL } = await this.secretManager.getSecrets([
      'TRANSFERO_ACCOUNT_ID',
      'TRANSFERO_BASE_URL',
    ])

    return {
      accountId: TRANSFERO_ACCOUNT_ID,
      baseUrl: TRANSFERO_BASE_URL,
    }
  }

  private hasValidLength(digits: string): boolean {
    return digits.length === 10 || digits.length === 11
  }

  private isRetryableError(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      return !status || status >= 500
    }
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('tax id is missing')) {
      return false
    }
    return true
  }

  private isTollFreeNumber(digits: string): boolean {
    return /^0800\d{7}$/.test(digits)
  }

  private isValidLocalNumber(local: string): boolean {
    if (local.length === 8) {
      return /^[2-5]\d{7}$/.test(local)
    }

    if (local.length === 9) {
      return /^9\d{8}$/.test(local)
    }

    return false
  }

  private normalizeBrazilPhoneNumber(input: null | number | string | undefined): null | string {
    if (input === null || input === undefined) return null

    const digits = this.stripToDigits(input)
    if (!digits) return null

    if (this.isTollFreeNumber(digits)) {
      return digits
    }

    const normalized = this.removeCarrierPrefix(digits)
    if (!this.hasValidLength(normalized)) {
      return null
    }

    const ddd = normalized.slice(0, 2)
    const local = normalized.slice(2)
    if (!this.brazilDdds.has(ddd) || !this.isValidLocalNumber(local)) {
      return null
    }

    return normalized
  }

  private readNumberFromEnv(envKey: string, fallback: number): number {
    const raw = process.env[envKey]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private removeCarrierPrefix(digits: string): string {
    if (/^0\d{2}\d{10,11}$/.test(digits)) {
      return digits.slice(3)
    }

    if (digits.length >= 11 && digits.startsWith('0')) {
      return digits.slice(1)
    }

    return digits
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  private stripToDigits(input: number | string): string {
    return String(input).replace(/\D+/g, '')
  }
}
