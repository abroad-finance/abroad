import { TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject } from 'inversify'

import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { Bank, IPaymentService } from '../../interfaces/IPaymentService'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

const TRANSFERO_BANKS: Bank[] = [{ bankCode: 1, bankName: 'PIX' }]

export class TransferoPaymentService implements IPaymentService {
  banks = TRANSFERO_BANKS
  currency: TargetCurrency = TargetCurrency.BRL
  fixedFee = 0.5
  readonly MAX_TOTAL_AMOUNT_PER_DAY = 25_000_000

  readonly MAX_USER_AMOUNT_PER_DAY = 25_000_000
  readonly MAX_USER_AMOUNT_PER_TRANSACTION = 5_000_000
  readonly MAX_USER_TRANSACTIONS_PER_DAY = 15
  percentageFee = 0

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
    bankCode,
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
      const token = await this.getTransferoToken()

      const contract = buildContract({ account, bankCode, taxId: transaction.taxId, value })

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
      )

      // Successful response: grab the paymentGroupId (or id)
      const transactionId
        = data?.paymentGroupId ?? data?.id ?? data?.[0]?.id ?? null

      return transactionId
        ? { success: true, transactionId }
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

  /** Obtains (or refreshes) a JWT for the BaaSiC API. */
  private async getTransferoToken(): Promise<string> {
    const { TRANSFERO_BASE_URL, TRANSFERO_CLIENT_ID, TRANSFERO_CLIENT_SECRET }
      = await this.secretManager.getSecrets([
        'TRANSFERO_BASE_URL',
        'TRANSFERO_CLIENT_ID',
        'TRANSFERO_CLIENT_SECRET',
      ])

    const { data } = await axios.post(
      `${TRANSFERO_BASE_URL}/auth/token`,
      {
        client_id: TRANSFERO_CLIENT_ID,
        client_secret: TRANSFERO_CLIENT_SECRET,
        grant_type: 'client_credentials',
      },
      { headers: { 'Content-Type': 'application/json' } },
    )

    return data?.access_token ?? ''
  }
}

/** Shapes the request body expected by /paymentgroup. */
function buildContract({
  account,
  bankCode,
  taxId,
  value,
}: {
  account: string
  bankCode: string
  taxId: string
  value: number
}) {
  if (bankCode === 'PIX') {
    return [
      {
        amount: value,
        currency: 'BRL',
        name: 'Recipient',
        pixKey: account,
        taxId,
        taxIdCountry: 'BRA',
      },
    ]
  }

  throw new Error(`Unsupported bank code: ${bankCode}`)
}
