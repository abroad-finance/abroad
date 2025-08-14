// src/services/transferoExchangeProvider.ts
import axios, { AxiosRequestConfig } from 'axios'
import { inject, injectable } from 'inversify'

import { IExchangeProvider } from '../../interfaces/IExchangeProvider'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

interface Account {
  accountId: string
  bankAccount: null
  bankBeneficiaryName: null
  bankBeneficiaryTaxId: null
  bankBeneficiaryTaxIdCountry: number
  bankBranch: null
  bankName: null
  currency: string
  depositAddress: Record<string, string>
  feeBankReconciliation: number
  feeFlat: number
  feePayIn: number
  feePayOut: number
  isPixPaymentEnable: boolean
  label: string
  pixKeys: null
  wallet: string[]
}

@injectable()
export class TransferoExchangeProvider implements IExchangeProvider {
  /**
   * 0.70 % pay-in + 0.30 % FX spread (customise if your contract differs)
   */
  readonly exchangePercentageFee = -0.01

  private cachedToken?: { exp: number, value: string }

  /** ---------- Public API implementation ---------- */

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
  ) { }

  /**
             * Retrieves (or creates) the deposit wallet for the partner account.
             * Falls back to the first wallet that matches both currency and chain.
             */
  getExchangeAddress: IExchangeProvider['getExchangeAddress'] = async ({
    blockchain,
    cryptoCurrency,
  }) => {
    const token = await this.getAccessToken()
    const apiUrl = await this.secretManager.getSecret('TRANSFERO_BASE_URL')

    const cfg: AxiosRequestConfig = {
      headers: { Authorization: `Bearer ${token}` },
    }

    // GET /accounts ⇒ array with `wallet` objects
    const { data: accounts } = await axios.get(
      `${apiUrl}/api/v2.0/accounts`,
      cfg,
    ) as { data: Account[] } /* :contentReference[oaicite:1]{index=1} */

    const account = accounts.find((account: Account) => {
      if (account.currency !== cryptoCurrency) return false
      const networks = Object.keys(account.depositAddress)
      return networks.some(
        network => network.toLowerCase() === blockchain.toLowerCase(),
      )
    })

    if (!account) {
      throw new Error(
        `No account found for ${cryptoCurrency} on ${blockchain} network`,
      )
    }

    return {
      address: account.depositAddress[blockchain.toLowerCase()],
    }
  }

  /** ---------- Internals ---------- */

  /**
 * Uses “request quote” with `fromSize = 1` to obtain the unit price.
 */
  getExchangeRate: IExchangeProvider['getExchangeRate'] = async ({
    sourceCurrency,
    targetCurrency,
  }) => {
    try {
      const token = await this.getAccessToken()
      const apiUrl = await this.secretManager.getSecret('TRANSFERO_BASE_URL')

      const { data } = await axios.post(
        `${apiUrl}/api/quote/v2.0/requestquote`,
        {
          baseCurrency: sourceCurrency,
          baseCurrencySize: 0,
          quoteCurrency: targetCurrency,
          quoteCurrencySize: 1,
          side: 'buy',
        },
        { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
      )

      const price = Number(data[0].price ?? data[0].Price)
      if (!price || Number.isNaN(price))
        throw new Error('Invalid price returned from Transfero')

      console.log(`Exchange rate from ${sourceCurrency} to ${targetCurrency}: ${price}`)

      return price
    }
    catch (error) {
      console.error('Error getting exchange rate:', error)
      throw new Error(`Failed to get exchange rate: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
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
