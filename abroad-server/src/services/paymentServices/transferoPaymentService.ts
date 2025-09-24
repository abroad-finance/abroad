import { TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject } from 'inversify'

import { ILogger } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { IPaymentService } from '../../interfaces/IPaymentService'
import { IPixQrDecoder } from '../../interfaces/IQrDecoder'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

interface Payment {
  amount: number
  currency: string
  name: string
  paymentId: string
  pixKey: string
  taxId: string
  taxIdCountry: number
}

interface TransactionTransfero {
  createdAt: string
  numberOfPayments: number
  numberOfPaymentsCompletedWithError: number
  numberOfPaymentsCompletedWithSuccess: number
  numberOfPaymentsPending: number
  numberOfPaymentsProcessing: number
  paymentGroupId: string
  payments: Payment[]
  totalAmount: number
  totalAmountPaymentsCompletedWithSuccess: number
}

interface TransferoBalanceResponse {
  balance?: {
    amount?: number | string
    currency?: string
  }
}

export class TransferoPaymentService implements IPaymentService {
  banks = []
  currency: TargetCurrency = TargetCurrency.BRL
  fixedFee = 0.0
  isAsync: boolean = true

  readonly MAX_TOTAL_AMOUNT_PER_DAY = Number.POSITIVE_INFINITY
  readonly MAX_USER_AMOUNT_PER_DAY = Number.POSITIVE_INFINITY
  readonly MAX_USER_AMOUNT_PER_TRANSACTION = Number.POSITIVE_INFINITY
  readonly MAX_USER_TRANSACTIONS_PER_DAY = Number.POSITIVE_INFINITY

  percentageFee = 0.0

  private cachedToken?: { exp: number, value: string }

  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider) private databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPixQrDecoder) private pixQrDecoder: IPixQrDecoder,
    @inject(TYPES.ILogger) private logger: ILogger,
  ) { }

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

  getLiquidity = async () => {
    try {
      const token = await this.getAccessToken()
      const { TRANSFERO_ACCOUNT_ID, TRANSFERO_BASE_URL } = await this.secretManager.getSecrets([
        'TRANSFERO_ACCOUNT_ID',
        'TRANSFERO_BASE_URL',
      ])

      const { data } = await axios.get<TransferoBalanceResponse>(
        `${TRANSFERO_BASE_URL}/api/v2.0/accounts/${TRANSFERO_ACCOUNT_ID}/balance`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      )

      const expectedCurrency = this.currency.toUpperCase()
      const liquidity = this.extractLiquidityFromBalance(data, expectedCurrency)

      if (liquidity !== null) {
        return liquidity
      }

      this.logger.warn('Transfero getLiquidity unexpected payload', {
        balance: data?.balance,
        expectedCurrency,
      })
      return 0
    }
    catch (err) {
      let logPayload: string
      if (axios.isAxiosError(err)) {
        logPayload = JSON.stringify(err.response?.data || err.message)
      }
      else if (err instanceof Error) {
        logPayload = err.message
      }
      else {
        logPayload = String(err)
      }

      this.logger.error('Transfero getLiquidity error:', logPayload)
      return 0
    }
  }

  onboardUser(): Promise<{ message?: string, success: boolean }> {
    throw new Error('Method not implemented for this payment service.')
  }

  async sendPayment({
    account,
    id,
    qrCode,
    value,
  }: {
    account: string
    bankCode: string
    id: string
    qrCode?: null | string
    value: number
  }): Promise<
    | { success: false }
    | { success: true, transactionId: string }
  > {
    try {
      const dbClient = await this.databaseClientProvider.getClient()
      const transaction = await dbClient.transaction.findUnique({
        where: { id },
      })
      if (!transaction || !transaction.taxId) {
        throw new Error('Partner user not found or tax ID is missing.')
      }
      const token = await this.getAccessToken()

      const contract = await this.buildContract({ account, qrCode, taxId: transaction.taxId, value })

      const { TRANSFERO_ACCOUNT_ID, TRANSFERO_BASE_URL } = await this.secretManager.getSecrets([
        'TRANSFERO_ACCOUNT_ID',
        'TRANSFERO_BASE_URL',
      ])

      const { data } = await axios.post(
        `${TRANSFERO_BASE_URL}/api/v2.0/accounts/${TRANSFERO_ACCOUNT_ID}/paymentgroup`,
        contract,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      ) as { data: TransactionTransfero }

      const paymentId = data.payments[0].paymentId || null

      return paymentId
        ? { success: true, transactionId: paymentId }
        : { success: false }
    }
    catch (err) {
      // Log / handle error as preferred
      let logPayload: string
      if (axios.isAxiosError(err)) {
        logPayload = JSON.stringify(err.response?.data || err.message)
      }
      else if (err instanceof Error) {
        logPayload = err.message
      }
      else {
        logPayload = String(err)
      }
      this.logger.error('Transfero sendPayment error:', logPayload)
      return { success: false }
    }
  }

  verifyAccount(): Promise<boolean> {
    // Transfero does not support account verification
    return Promise.resolve(true)
  }

  /** Shapes the request body expected by /paymentgroup. */
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
  }) {
    const isBrazilPhoneNumber = (input: number | string): boolean => {
      if (input === null || input === undefined) return false

      // Keep digits only
      const raw = String(input).replace(/\D+/g, '')
      if (!raw) return false

      // Accept toll-free 0800 numbers: 0800 + 7 digits
      if (/^0800\d{7}$/.test(raw)) return true

      // Strip domestic prefixes if present:
      // - 0 + carrier code (two digits), e.g., 0 15 11 9xxxx-xxxx  => remove "015"
      // - single trunk "0" before DDD, e.g., 0 11 2345-6789        => remove "0"
      let digits = raw
      if (/^0\d{2}\d{10,11}$/.test(digits)) {
        digits = digits.slice(3)
      }
      else if (digits.length >= 11 && digits.startsWith('0')) {
        digits = digits.slice(1)
      }

      // After cleaning, expect 10 (landline) or 11 (mobile) digits: DDD(2) + local
      if (!(digits.length === 10 || digits.length === 11)) return false

      const ddd = digits.slice(0, 2)
      const local = digits.slice(2)

      // Valid Brazilian DDD (area) codes
      const VALID_DDD = new Set([
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

      if (!VALID_DDD.has(ddd)) return false

      // Landline: 8 digits, starts 2–5
      if (local.length === 8) {
        return /^[2-5]\d{7}$/.test(local)
      }

      // Mobile: 9 digits, starts with 9
      if (local.length === 9) {
        // If you want to be stricter, use /^9[6-9]\d{7}$/ (historical mobile ranges)
        return /^9\d{8}$/.test(local)
      }

      return false
    }

    if (qrCode) {
      const decoded = await this.pixQrDecoder.decode(qrCode)
      return [
        {
          amount: value,
          currency: 'BRL',
          name: decoded?.name || 'Recipient',
          qrCode,
          taxId: decoded?.taxId || taxId,
          taxIdCountry: 'BRA',
        },
      ]
    }

    const pixKey = isBrazilPhoneNumber(account) ? `+55${String(account).replace(/\D/g, '')}` : account
    return [
      {
        amount: value,
        currency: 'BRL',
        name: 'Recipient',
        pixKey,
        taxId,
        taxIdCountry: 'BRA',
      },
    ]
  }

  private extractLiquidityFromBalance(
    response: TransferoBalanceResponse,
    expectedCurrency: string,
  ): null | number {
    const amount = TransferoPaymentService.parseAmount(response?.balance?.amount)
    if (amount === null) return null

    const currency = response?.balance?.currency
    if (currency && currency.toUpperCase() !== expectedCurrency) return null

    return amount
  }

  /** OAuth2 client-credentials flow */
  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && now < this.cachedToken.exp - 60_000) {
      return this.cachedToken.value
    }

    const apiUrl = await this.secretManager.getSecret('TRANSFERO_BASE_URL')
    const clientId = await this.secretManager.getSecret('TRANSFERO_CLIENT_ID')
    const clientSecret = await this.secretManager.getSecret(
      'TRANSFERO_CLIENT_SECRET',
    )
    const clientScope = await this.secretManager.getSecret('TRANSFERO_CLIENT_SCOPE')

    const { data } = await axios.post(`${apiUrl}/auth/token`, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: clientScope,
    }, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const value = data.access_token ?? data
    const seconds = Number(data.expires_in ?? 900) // default 15 min
    this.cachedToken = { exp: now + seconds * 1000, value }

    return value
  }
}
