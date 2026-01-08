import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
// src/services/transferoExchangeProvider.ts
import axios from 'axios'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { ExchangeAddressResult, ExchangeFailureCode, IExchangeProvider } from '../../application/contracts/IExchangeProvider'

@injectable()
export class TransferoExchangeProvider implements IExchangeProvider {
  public readonly capability = { blockchain: BlockchainNetwork.STELLAR, targetCurrency: TargetCurrency.BRL }
  readonly exchangePercentageFee = 0.001

  private cachedToken?: { exp: number, value: string }
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoExchangeProvider' })
  }

  async createMarketOrder({ sourceAmount, sourceCurrency, targetCurrency }: { sourceAmount: number, sourceCurrency: CryptoCurrency, targetCurrency: TargetCurrency }): Promise<{ success: boolean }> {
    try {
      const token = await this.getAccessToken()
      const { TRANSFERO_BASE_URL: apiUrl } = await this.secretManager.getSecrets([
        'TRANSFERO_BASE_URL',
      ])

      // create quote:
      const { data } = await axios.post(
        `${apiUrl}/api/quote/v2.0/requestquote`,
        {
          baseCurrency: sourceCurrency,
          baseCurrencySize: sourceAmount,
          quoteCurrency: targetCurrency,
          quoteCurrencySize: 0,
          side: 'sell',
        },
        { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
      )

      const quoteId = data[0].quoteId

      // acceptquote
      const { data: acceptQuoteData } = await axios.post(
        `${apiUrl}/api/trade/v2.0/acceptquote`,
        {
          name: 'Abroad',
          quoteId,
        },
        { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
      )

      return { success: acceptQuoteData.success }
    }
    catch (error) {
      this.logger.error('Error creating market order', error)
      return { success: false }
    }
  }

  /**
           * Retrieves (or creates) the deposit wallet for the partner account.
           * Falls back to the first wallet that matches both currency and chain.
           */
  getExchangeAddress: IExchangeProvider['getExchangeAddress'] = async ({
    blockchain,
  }): Promise<ExchangeAddressResult> => {
    if (blockchain !== BlockchainNetwork.STELLAR) {
      return { code: 'validation', reason: `Unsupported blockchain: ${blockchain}`, success: false }
    }

    const { TRANSFERO_STELLAR_WALLET: transferoStellarWallet } = await this.secretManager.getSecrets([
      'TRANSFERO_STELLAR_WALLET',
    ])

    return {
      address: transferoStellarWallet,
      success: true,
    }
  }

  /** ---------- Internals ---------- */

  /**
 * Uses “request quote” with `fromSize = 1` to obtain the unit price.
 */
  getExchangeRate: IExchangeProvider['getExchangeRate'] = async ({
    sourceAmount,
    sourceCurrency,
    targetAmount,
    targetCurrency,
  }) => {
    try {
      const token = await this.getAccessToken()
      const { TRANSFERO_BASE_URL: apiUrl } = await this.secretManager.getSecrets([
        'TRANSFERO_BASE_URL',
      ])

      const { data } = await axios.post(
        `${apiUrl}/api/quote/v2.0/requestquote`,
        {
          baseCurrency: sourceCurrency,
          baseCurrencySize: sourceAmount,
          quoteCurrency: targetCurrency,
          quoteCurrencySize: targetAmount,
          side: 'sell',
        },
        { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
      )

      const price = Number(data[0].price ?? data[0].Price)
      if (!price || Number.isNaN(price))
        throw new Error('Invalid price returned from Transfero')

      this.logger.info('Fetched exchange rate', { price, sourceAmount, sourceCurrency, targetAmount, targetCurrency })

      return sourceAmount ? (sourceAmount / price) : targetAmount ? (price / targetAmount) : 0
    }
    catch (error) {
      this.logger.error('Error getting exchange rate', error)
      throw new Error(`Failed to get exchange rate: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private buildFailure(code: ExchangeFailureCode, reason?: string): ExchangeAddressResult {
    return { code, reason, success: false }
  }

  /** OAuth2 client-credentials flow */
  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && now < this.cachedToken.exp - 60_000) {
      return this.cachedToken.value
    }

    const {
      TRANSFERO_BASE_URL,
      TRANSFERO_CLIENT_ID,
      TRANSFERO_CLIENT_SCOPE,
      TRANSFERO_CLIENT_SECRET,
    } = await this.secretManager.getSecrets([
      'TRANSFERO_BASE_URL',
      'TRANSFERO_CLIENT_ID',
      'TRANSFERO_CLIENT_SECRET',
      'TRANSFERO_CLIENT_SCOPE',
    ])

    const { data } = await axios.post(`${TRANSFERO_BASE_URL}/auth/token`, {
      client_id: TRANSFERO_CLIENT_ID,
      client_secret: TRANSFERO_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: TRANSFERO_CLIENT_SCOPE,
    }, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const value = data.access_token ?? data
    const seconds = Number(data.expires_in ?? 900) // default 15 min
    this.cachedToken = { exp: now + seconds * 1000, value }

    return value
  }
}
