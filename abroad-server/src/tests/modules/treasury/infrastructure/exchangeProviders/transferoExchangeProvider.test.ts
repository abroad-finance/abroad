import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import axios from 'axios'

import { TransferoExchangeProvider } from '../../../../../modules/treasury/infrastructure/exchangeProviders/transferoExchangeProvider'
import { ISecretManager, Secret } from '../../../../../platform/secrets/ISecretManager'
import { createMockLogger } from '../../../../setup/mockFactories'

jest.mock('axios')

class SecretManagerStub implements ISecretManager {
  constructor(private readonly secrets: Partial<Record<Secret, string>>) { }

  async getSecret(secretName: Secret): Promise<string> {
    return this.secrets[secretName] ?? ''
  }

  async getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    const result: Record<string, string> = {}
    secretNames.forEach((name) => {
      result[name] = this.secrets[name] ?? ''
    })
    return result as Record<T[number], string>
  }
}

const mockedAxios = axios as jest.Mocked<typeof axios>

const baseSecrets: Partial<Record<Secret, string>> = {
  TRANSFERO_BASE_URL: 'https://transfero.test',
  TRANSFERO_CLIENT_ID: 'id-1',
  TRANSFERO_CLIENT_SCOPE: 'scope-1',
  TRANSFERO_CLIENT_SECRET: 'secret-1',
  TRANSFERO_STELLAR_WALLET: 'stellar-wallet',
}

describe('TransferoExchangeProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const createProvider = (secrets: Partial<Record<Secret, string>> = baseSecrets) =>
    new TransferoExchangeProvider(new SecretManagerStub(secrets), createMockLogger())

  describe('getExchangeAddress', () => {
    it('returns the configured stellar wallet', async () => {
      const provider = createProvider()

      const address = await provider.getExchangeAddress({
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
      })

      expect(address).toEqual({ address: 'stellar-wallet' })
    })

    it('throws for unsupported blockchains', async () => {
      const provider = createProvider()

      await expect(provider.getExchangeAddress({
        blockchain: BlockchainNetwork.SOLANA,
        cryptoCurrency: CryptoCurrency.USDC,
      })).rejects.toThrow('Unsupported blockchain: SOLANA')
    })
  })

  describe('getExchangeRate', () => {
    it('returns source-based pricing', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 900 } })
        .mockResolvedValueOnce({ data: [{ price: '2.5' }] })

      const provider = createProvider()

      const rate = await provider.getExchangeRate({
        sourceAmount: 10,
        sourceCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.BRL,
      })

      expect(rate).toBeCloseTo(4)
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://transfero.test/auth/token',
        {
          client_id: 'id-1',
          client_secret: 'secret-1',
          grant_type: 'client_credentials',
          scope: 'scope-1',
        },
        {
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      )
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://transfero.test/api/quote/v2.0/requestquote',
        expect.objectContaining({
          baseCurrency: CryptoCurrency.USDC,
          baseCurrencySize: 10,
          quoteCurrency: TargetCurrency.BRL,
          quoteCurrencySize: undefined,
          side: 'sell',
        }),
        expect.any(Object),
      )
    })

    it('returns target-based pricing when source amount is undefined', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { access_token: 'token-2', expires_in: 900 } })
        .mockResolvedValueOnce({ data: [{ price: '200' }] })

      const provider = createProvider()

      const rate = await provider.getExchangeRate({
        sourceCurrency: CryptoCurrency.USDC,
        targetAmount: 100,
        targetCurrency: TargetCurrency.BRL,
      })

      expect(rate).toBeCloseTo(2)
    })

    it('throws when Transfero returns an invalid price', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { access_token: 'token-3', expires_in: 900 } })
        .mockResolvedValueOnce({ data: [{ price: undefined }] })

      const provider = createProvider()

      await expect(provider.getExchangeRate({
        sourceAmount: 1,
        sourceCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.COP,
      })).rejects.toThrow('Invalid price returned from Transfero')
    })

    it('reuses cached access tokens to avoid extra auth requests', async () => {
      const provider = createProvider()
      Reflect.set(
        provider as unknown as Record<string, unknown>,
        'cachedToken',
        { exp: Date.now() + 120_000, value: 'cached-token' },
      )

      mockedAxios.post.mockResolvedValueOnce({ data: [{ price: '10' }] })

      const rate = await provider.getExchangeRate({
        sourceAmount: 20,
        sourceCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.BRL,
      })

      expect(rate).toBeCloseTo(2)
      expect(mockedAxios.post).toHaveBeenCalledTimes(1)
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://transfero.test/api/quote/v2.0/requestquote',
        expect.objectContaining({
          baseCurrency: CryptoCurrency.USDC,
          baseCurrencySize: 20,
          quoteCurrency: TargetCurrency.BRL,
        }),
        expect.any(Object),
      )
    })
  })

  describe('createMarketOrder', () => {
    it('returns success when quote acceptance succeeds', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { access_token: 'token-4', expires_in: 900 } })
        .mockResolvedValueOnce({ data: [{ quoteId: 'q-1' }] })
        .mockResolvedValueOnce({ data: { success: true } })

      const provider = createProvider()
      const result = await provider.createMarketOrder({
        sourceAmount: 5,
        sourceCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.BRL,
      })

      expect(result).toEqual({ success: true })
    })

    it('returns false when quote creation fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network down'))

      const provider = createProvider()
      const result = await provider.createMarketOrder({
        sourceAmount: 5,
        sourceCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.BRL,
      })

      expect(result).toEqual({ success: false })
    })
  })
})
