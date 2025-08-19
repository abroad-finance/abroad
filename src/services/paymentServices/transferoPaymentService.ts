import { TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject } from 'inversify'

import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { IPaymentService } from '../../interfaces/IPaymentService'
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

export class TransferoPaymentService implements IPaymentService {
  banks = []
  currency: TargetCurrency = TargetCurrency.BRL
  fixedFee = 0.0
  isAsync: boolean = true

  readonly MAX_TOTAL_AMOUNT_PER_DAY = 25_000_000
  readonly MAX_USER_AMOUNT_PER_DAY = 25_000_000
  readonly MAX_USER_AMOUNT_PER_TRANSACTION = 5_000_000
  readonly MAX_USER_TRANSACTIONS_PER_DAY = 15

  percentageFee = 0.0

  private cachedToken?: { exp: number, value: string }

  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider) private databaseClientProvider: IDatabaseClientProvider,
  ) { }

  getLiquidity = async () => {
    throw new Error('Method not implemented for this payment service.')
  }

  onboardUser(): Promise<{ message?: string, success: boolean }> {
    throw new Error('Method not implemented for this payment service.')
  }

  async sendPayment({
    account,
    id,
    value,
  }: {
    account: string
    bankCode: string
    id: string
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

      const contract = buildContract({ account, taxId: transaction.taxId, value })

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
      console.error('Transfero sendPayment error:', err)
      return { success: false }
    }
  }

  verifyAccount(): Promise<boolean> {
    // Transfero does not support account verification
    return Promise.resolve(true)
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

/** Shapes the request body expected by /paymentgroup. */
function buildContract({
  account,
  taxId,
  value,
}: {
  account: string
  taxId: string
  value: number
}) {
  // Normalize Pix key if it's a Brazilian phone number to E.164 (+55...) format
  const normalizeBrazilPhonePixKey = (raw: string): string => {
    const trimmed = (raw || '').trim()
    if (!trimmed) return raw

    // Already has +55
    if (trimmed.startsWith('+55')) {
      // strip non-digits except leading +
      const digits = trimmed.replace(/[^\d+]/g, '')
      return digits
    }

    // If it starts with 55 and has 12-13 digits, consider it's missing the plus
    const onlyDigits = trimmed.replace(/\D/g, '')
    if (onlyDigits.startsWith('55') && (onlyDigits.length === 12 || onlyDigits.length === 13)) {
      return `+${onlyDigits}`
    }

    // If it contains formatting chars and ends up 10-11 digits, consider local BR number
    const hadFormatting = /[()\s-]/.test(trimmed)
    if (hadFormatting && (onlyDigits.length === 10 || onlyDigits.length === 11)) {
      return `+55${onlyDigits}`
    }

    // Otherwise, leave as-is
    return raw
  }

  const pixKey = normalizeBrazilPhonePixKey(account)
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
