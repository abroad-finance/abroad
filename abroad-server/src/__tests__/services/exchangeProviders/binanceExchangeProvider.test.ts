import { Wallet } from '@binance/wallet'
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import axios from 'axios'

import { ISecretManager, Secret } from '../../../interfaces/ISecretManager'
import { BinanceExchangeProvider } from '../../../services/exchangeProviders/binanceExchangeProvider'
import { createMockLogger } from '../../setup/mockFactories'

jest.mock('axios', () => ({
  get: jest.fn(),
}))

const depositAddressMock = jest.fn()

jest.mock('@binance/wallet', () => ({
  Wallet: jest.fn().mockImplementation(() => ({
    restAPI: { depositAddress: depositAddressMock },
  })),
}))

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
const MockedWallet = Wallet as jest.MockedClass<typeof Wallet>

const defaultSecrets: Partial<Record<Secret, string>> = {
  BINANCE_API_KEY: 'api-key',
  BINANCE_API_SECRET: 'api-secret',
  BINANCE_API_URL: 'https://binance.test',
}

describe('BinanceExchangeProvider', () => {
  beforeEach(() => {
    depositAddressMock.mockReset()
    MockedWallet.mockClear()
    mockedAxios.get.mockReset()
  })

  const createProvider = (secrets: Partial<Record<Secret, string>> = defaultSecrets) => {
    const secretManager = new SecretManagerStub(secrets)
    return new BinanceExchangeProvider(secretManager, createMockLogger())
  }

  describe('getExchangeAddress', () => {
    it('returns deposit address and memo for supported blockchains', async () => {
      depositAddressMock.mockResolvedValue({
        data: () => Promise.resolve({ address: 'addr-1', tag: 'memo-1' }),
      })

      const provider = createProvider()
      const result = await provider.getExchangeAddress({
        blockchain: BlockchainNetwork.SOLANA,
        cryptoCurrency: CryptoCurrency.USDC,
      })

      expect(MockedWallet).toHaveBeenCalledWith({
        configurationRestAPI: {
          apiKey: 'api-key',
          apiSecret: 'api-secret',
          basePath: 'https://binance.test',
        },
      })
      expect(depositAddressMock).toHaveBeenCalledWith({ coin: CryptoCurrency.USDC, network: 'SOL' })
      expect(result).toEqual({ address: 'addr-1', memo: 'memo-1' })
    })

    it('throws when Binance does not return an address', async () => {
      depositAddressMock.mockResolvedValue({
        data: () => Promise.resolve({}),
      })

      const provider = createProvider()

      await expect(provider.getExchangeAddress({
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
      })).rejects.toThrow('No deposit address returned from Binance')
    })

    it('throws for unsupported blockchain networks', async () => {
      depositAddressMock.mockResolvedValue({
        data: () => Promise.resolve({ address: 'unused' }),
      })

      const provider = createProvider()

      await expect(provider.getExchangeAddress({
        blockchain: 'UNKNOWN' as unknown as BlockchainNetwork,
        cryptoCurrency: CryptoCurrency.USDC,
      })).rejects.toThrow('Unsupported blockchain: UNKNOWN')
    })
  })

  describe('getExchangeRate', () => {
    it('returns the cross rate using USDT pairs for supported symbols', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { askPrice: '4.2', askQty: '1', bidPrice: '4.1', bidQty: '1', symbol: 'USDCUSDT' } })
        .mockResolvedValueOnce({ data: { askPrice: '2.1', askQty: '1', bidPrice: '2.0', bidQty: '1', symbol: 'USDTCOP' } })

      const provider = createProvider()
      const rate = await provider.getExchangeRate({
        sourceAmount: 100,
        sourceCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.COP,
      })

      expect(rate).toBeCloseTo(2)
      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        1,
        'https://binance.test/api/v3/ticker/bookTicker?symbol=USDCUSDT',
      )
      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        2,
        'https://binance.test/api/v3/ticker/bookTicker?symbol=USDTCOP',
      )
    })

    it('throws when the symbol is not supported', async () => {
      const provider = createProvider()

      await expect(provider.getExchangeRate({
        sourceAmount: 50,
        sourceCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.BRL,
      })).rejects.toThrow('Unsupported symbol: USDCBRL')
      expect(mockedAxios.get).not.toHaveBeenCalled()
    })

    it('throws when Binance returns invalid pricing data', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { askPrice: '1', askQty: '1', bidPrice: '1', bidQty: '1', symbol: 'USDCUSDT' } })
        .mockResolvedValueOnce({ data: { askPrice: 'not-a-number', askQty: '1', bidPrice: '1', bidQty: '1', symbol: 'USDTCOP' } })

      const provider = createProvider()

      await expect(provider.getExchangeRate({
        sourceAmount: 10,
        sourceCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.COP,
      })).rejects.toThrow('Invalid price data received from Binance')
    })
  })
})
