import 'reflect-metadata'
import { TargetCurrency } from '@prisma/client'
import axios, { type AxiosResponse } from 'axios'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IPixQrDecoder } from '../../interfaces/IQrDecoder'
import type { ISecretManager } from '../../interfaces/ISecretManager'

import { TransferoPaymentService } from '../../services/paymentServices/transferoPaymentService'
import { createMockLogger, MockLogger } from '../setup/mockFactories'

jest.mock('axios')

const mockedAxios = axios as jest.Mocked<typeof axios>

type PrismaLike = {
  transaction: {
    findUnique: jest.Mock
  }
}

const createSecretManager = (overrides?: Record<string, string>): ISecretManager => {
  const secrets: Record<string, string> = {
    TRANSFERO_ACCOUNT_ID: 'account-1',
    TRANSFERO_BASE_URL: 'https://transfero.example.com',
    TRANSFERO_CLIENT_ID: 'client-id',
    TRANSFERO_CLIENT_SCOPE: 'payments',
    TRANSFERO_CLIENT_SECRET: 'client-secret',
    ...overrides,
  }

  return {
    getSecret: jest.fn(async (name: string) => secrets[name] ?? ''),
    getSecrets: jest.fn(async <T extends readonly string[]>(names: T) => {
      return names.reduce<Record<T[number], string>>((acc, key) => {
        const typedKey = key as T[number]
        acc[typedKey] = secrets[typedKey] ?? ''
        return acc
      }, {} as Record<T[number], string>)
    }),
  }
}

describe('TransferoPaymentService', () => {
  let secretManager: ISecretManager
  let prismaClient: PrismaLike
  let dbProvider: IDatabaseClientProvider
  let pixDecoder: IPixQrDecoder
  let logger: MockLogger

  beforeEach(() => {
    jest.restoreAllMocks()
    mockedAxios.get.mockReset()
    mockedAxios.post.mockReset()
    mockedAxios.isAxiosError.mockReturnValue(false)

    secretManager = createSecretManager()
    prismaClient = {
      transaction: {
        findUnique: jest.fn(),
      },
    }
    dbProvider = {
      getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider
    pixDecoder = {
      decode: jest.fn(async () => ({ name: 'QR Recipient', taxId: 'TAX-QR' })),
    }
    logger = createMockLogger()
  })

  describe('getAccessToken', () => {
    it('caches the token until nearly expired', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }

      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token-1', expires_in: 120 },
      } as AxiosResponse<{ access_token: string, expires_in: number }>)

      const first = await tokenAccessor.getAccessToken()
      nowSpy.mockReturnValue(1_020_000) // still within lifetime (120s - 60s buffer)
      const second = await tokenAccessor.getAccessToken()

      expect(first).toBe('token-1')
      expect(second).toBe('token-1')
      expect(mockedAxios.post).toHaveBeenCalledTimes(1)
      nowSpy.mockRestore()
    })
  })

  describe('getLiquidity', () => {
    it('returns parsed liquidity and logs unexpected currency', async () => {
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }
      jest.spyOn(tokenAccessor, 'getAccessToken').mockResolvedValue('token-123')
      const balanceResponse = { balance: { amount: '1.234,56', currency: 'BRL' } }
      mockedAxios.get.mockResolvedValueOnce({ data: balanceResponse } as AxiosResponse<typeof balanceResponse>)

      const liquidity = await service.getLiquidity()
      expect(liquidity).toBeCloseTo(1234.56)
      expect(logger.warn).not.toHaveBeenCalled()

      const usdBalance = { balance: { amount: 500, currency: 'USD' } }
      mockedAxios.get.mockResolvedValueOnce({ data: usdBalance } as AxiosResponse<typeof usdBalance>)
      const mismatch = await service.getLiquidity()

      expect(mismatch).toBe(0)
      expect(logger.warn).toHaveBeenCalledWith(
        'Transfero getLiquidity unexpected payload',
        { balance: usdBalance.balance, expectedCurrency: TargetCurrency.BRL.toUpperCase() },
      )
    })

    it('logs and returns zero on upstream failures', async () => {
      mockedAxios.isAxiosError.mockReturnValue(false)
      mockedAxios.get.mockRejectedValueOnce(new Error('network down'))
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }
      jest.spyOn(tokenAccessor, 'getAccessToken').mockResolvedValue('token-123')

      const liquidity = await service.getLiquidity()

      expect(liquidity).toBe(0)
      expect(logger.error).toHaveBeenCalledWith('Transfero getLiquidity error:', 'network down')
    })

    it('stringifies axios error payloads on failures', async () => {
      mockedAxios.isAxiosError.mockReturnValueOnce(true)
      mockedAxios.get.mockRejectedValueOnce({ response: { data: { detail: 'bad' } } })
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }
      jest.spyOn(tokenAccessor, 'getAccessToken').mockResolvedValue('token-err')

      const liquidity = await service.getLiquidity()

      expect(liquidity).toBe(0)
      expect(logger.error).toHaveBeenCalledWith('Transfero getLiquidity error:', JSON.stringify({ detail: 'bad' }))
    })

    it('falls back to error message when axios payload is empty', async () => {
      mockedAxios.isAxiosError.mockReturnValueOnce(true)
      mockedAxios.get.mockRejectedValueOnce({ message: 'boom' })
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }
      jest.spyOn(tokenAccessor, 'getAccessToken').mockResolvedValue('token-msg')

      const liquidity = await service.getLiquidity()

      expect(liquidity).toBe(0)
      expect(logger.error).toHaveBeenCalledWith('Transfero getLiquidity error:', JSON.stringify('boom'))
    })
  })

  describe('buildContract', () => {
    it('decodes QR codes to build PIX contract entries', async () => {
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const builder = service as unknown as {
        buildContract: (input: { account: string, qrCode: string, taxId: string, value: number }) => Promise<unknown[]>
      }

      const contract = await builder.buildContract({
        account: 'ignored',
        qrCode: 'qr-code',
        taxId: 'TAX-123',
        value: 50,
      })

      expect(contract).toEqual([{
        amount: 50,
        currency: 'BRL',
        name: 'QR Recipient',
        qrCode: 'qr-code',
        taxId: 'TAX-QR',
        taxIdCountry: 'BRA',
      }])
      expect(pixDecoder.decode).toHaveBeenCalledWith('qr-code')
    })

    it('formats Brazilian phone numbers as PIX keys and accepts non-Brazilian inputs', async () => {
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const builder = service as unknown as {
        buildContract: (input: { account: string, qrCode?: null, taxId: string, value: number }) => Promise<Array<Record<string, number | string>>>
      }

      const brazilian = await builder.buildContract({
        account: '0 21 98765-4321',
        qrCode: null,
        taxId: 'TAX-ABC',
        value: 75,
      })
      expect(brazilian[0]).toMatchObject({ pixKey: '+5521987654321', taxId: 'TAX-ABC' })

      const foreign = await builder.buildContract({
        account: 'user@example.com',
        qrCode: null,
        taxId: 'TAX-ABC',
        value: 75,
      })
      expect(foreign[0]).toMatchObject({ pixKey: 'user@example.com' })
    })

    it('accepts toll-free and carrier-prefixed domestic numbers while rejecting bad DDD codes', async () => {
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const builder = service as unknown as {
        buildContract: (input: { account: string, qrCode?: null, taxId: string, value: number }) => Promise<Array<Record<string, number | string>>>
      }

      const tollFree = await builder.buildContract({
        account: '0800 123 4567',
        qrCode: null,
        taxId: 'TAX-ABC',
        value: 10,
      })
      expect(tollFree[0]).toMatchObject({ pixKey: '+5508001234567' })

      const carrierPrefixed = await builder.buildContract({
        account: '015 11 91234-5678',
        qrCode: null,
        taxId: 'TAX-ABC',
        value: 10,
      })
      expect(carrierPrefixed[0]).toMatchObject({ pixKey: '+5511912345678' })

      const invalidDdd = await builder.buildContract({
        account: '001 23 456789',
        qrCode: null,
        taxId: 'TAX-ABC',
        value: 10,
      })
      expect(invalidDdd[0]).toMatchObject({ pixKey: '001 23 456789' })
    })
  })

  describe('sendPayment', () => {
    it('submits a payment group and returns the provider payment id', async () => {
      prismaClient.transaction.findUnique.mockResolvedValue({ id: 'txn-1', taxId: 'TAX-USER' })
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const builder = service as unknown as {
        buildContract: (input: { account: string, qrCode?: null | string, taxId: string, value: number }) => Promise<Array<Record<string, number | string>>>
      }
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }
      jest.spyOn(builder, 'buildContract').mockResolvedValue([{ amount: 10, currency: 'BRL', name: 'Recipient', pixKey: '+5511999999999', taxId: 'TAX-USER', taxIdCountry: 'BRA' }])
      jest.spyOn(tokenAccessor, 'getAccessToken').mockResolvedValue('token-123')

      mockedAxios.post.mockResolvedValueOnce({
        data: { payments: [{ paymentId: 'payment-123' }] },
      } as AxiosResponse<{ payments: Array<{ paymentId: string }> }>)

      const result = await service.sendPayment({
        account: '11999999999',
        bankCode: '001',
        id: 'txn-1',
        qrCode: null,
        value: 10,
      })

      expect(result).toEqual({ success: true, transactionId: 'payment-123' })
      expect(builder.buildContract).toHaveBeenCalledWith({
        account: '11999999999',
        qrCode: null,
        taxId: 'TAX-USER',
        value: 10,
      })
      expect(mockedAxios.post).toHaveBeenCalledTimes(1)
    })

    it('returns failure when the transaction lacks tax information', async () => {
      prismaClient.transaction.findUnique.mockResolvedValue(null)
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)

      const response = await service.sendPayment({
        account: '11999999999',
        bankCode: '001',
        id: 'missing',
        qrCode: null,
        value: 10,
      })

      expect(response).toEqual({ success: false })
      expect(logger.error).toHaveBeenCalledWith(
        'Transfero sendPayment error:',
        'Partner user not found or tax ID is missing.',
      )
    })

    it('logs axios error payloads when submission fails', async () => {
      prismaClient.transaction.findUnique.mockResolvedValue({ id: 'txn-err', taxId: 'TAX-ERR' })
      mockedAxios.isAxiosError.mockReturnValue(true)
      mockedAxios.post.mockRejectedValueOnce({ response: { data: { reason: 'denied' } } })
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }
      jest.spyOn(tokenAccessor, 'getAccessToken').mockResolvedValue('token-err')

      const result = await service.sendPayment({
        account: '11999999999',
        bankCode: '001',
        id: 'txn-err',
        qrCode: null,
        value: 10,
      })

      expect(result).toEqual({ success: false })
      expect(logger.error).toHaveBeenCalledWith(
        'Transfero sendPayment error:',
        JSON.stringify({ reason: 'denied' }),
      )
    })

    it('handles axios errors without response bodies', async () => {
      prismaClient.transaction.findUnique.mockResolvedValue({ id: 'txn-plain', taxId: 'TAX-PLAIN' })
      mockedAxios.isAxiosError.mockReturnValue(true)
      mockedAxios.post.mockRejectedValueOnce({ message: 'plain axios' })
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }
      jest.spyOn(tokenAccessor, 'getAccessToken').mockResolvedValue('token-plain')

      const result = await service.sendPayment({
        account: '123',
        bankCode: '001',
        id: 'txn-plain',
        qrCode: null,
        value: 5,
      })

      expect(result).toEqual({ success: false })
      expect(logger.error).toHaveBeenCalledWith('Transfero sendPayment error:', JSON.stringify('plain axios'))
    })
  })

  describe('helpers', () => {
    it('parses amounts and enforces expected currency when extracting liquidity', () => {
      const parser = TransferoPaymentService as unknown as {
        parseAmount: (raw: number | string | undefined) => null | number
      }
      expect(parser.parseAmount(25)).toBe(25)
      expect(parser.parseAmount(' 1.250,40 ')).toBeCloseTo(1250.40)
      expect(parser.parseAmount('not-a-number')).toBeNull()
      expect(parser.parseAmount(undefined)).toBeNull()

      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const extractor = service as unknown as {
        extractLiquidityFromBalance: (
          response: { balance?: { amount?: number | string, currency?: string } },
          expected: string
        ) => null | number
      }

      expect(extractor.extractLiquidityFromBalance({ balance: { amount: '100', currency: 'BRL' } }, 'BRL')).toBe(100)
      expect(extractor.extractLiquidityFromBalance({ balance: { amount: '100', currency: 'USD' } }, 'BRL')).toBeNull()
      expect(extractor.extractLiquidityFromBalance({ balance: { amount: 'oops', currency: 'BRL' } }, 'BRL')).toBeNull()
    })

    it('refreshes expired tokens and falls back when QR decoding lacks data', async () => {
      const nowSpy = jest.spyOn(Date, 'now')
      nowSpy.mockReturnValue(0)
      const service = new TransferoPaymentService(secretManager, dbProvider, { decode: jest.fn(async () => null) }, logger)
      const tokenAccessor = service as unknown as { getAccessToken: () => Promise<string> }
      mockedAxios.post.mockResolvedValue({ data: { access_token: 'fresh', expires_in: 1 } } as AxiosResponse<{ access_token: string, expires_in: number }>)

      const first = await tokenAccessor.getAccessToken()
      nowSpy.mockReturnValue(2000) // past expiry (1s - 60s buffer forces refresh)
      mockedAxios.post.mockResolvedValue({ data: { access_token: 'refreshed', expires_in: 900 } } as AxiosResponse<{ access_token: string, expires_in: number }>)
      const second = await tokenAccessor.getAccessToken()
      nowSpy.mockRestore()

      expect(first).toBe('fresh')
      expect(second).toBe('refreshed')

      const builder = service as unknown as {
        buildContract: (input: { account: string, qrCode?: null | string, taxId: string, value: number }) => Promise<Array<Record<string, null | number | string>>>
      }
      const contract = await builder.buildContract({
        account: 'abc-123',
        qrCode: 'qr-without-data',
        taxId: 'FALLBACK',
        value: 99,
      })
      expect(contract[0]).toMatchObject({ name: 'Recipient', taxId: 'FALLBACK' })
    })

    it('reuses cached tokens and exercises phone normalization edge cases', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const accessor = service as unknown as { getAccessToken: () => Promise<string> }
      mockedAxios.post.mockResolvedValue({ data: { access_token: 'cached', expires_in: 900 } } as AxiosResponse<{ access_token: string, expires_in: number }>)
      const first = await accessor.getAccessToken()
      nowSpy.mockReturnValue(1000)
      const second = await accessor.getAccessToken()
      expect(first).toBe(second)
      nowSpy.mockRestore()

      const builder = service as unknown as {
        buildContract: (input: { account: string, qrCode?: null | string, taxId: string, value: number }) => Promise<Array<Record<string, null | number | string>>>
      }

      const emptyDigits = await builder.buildContract({
        account: '---',
        qrCode: null,
        taxId: 'T',
        value: 1,
      })
      expect(emptyDigits[0]).toMatchObject({ pixKey: '---' })

      const nullInput = await builder.buildContract({
        account: null as unknown as string,
        qrCode: null,
        taxId: 'T',
        value: 1,
      })
      expect(nullInput[0]).toMatchObject({ pixKey: null })

      const invalidLandline = await builder.buildContract({
        account: '1199999999',
        qrCode: null,
        taxId: 'T',
        value: 1,
      })
      expect(invalidLandline[0]).toMatchObject({ pixKey: '1199999999' })
    })

    it('handles token responses without access_token or expiry', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        config: { headers: {} },
        data: { expires_in: undefined, token: 'raw' },
        headers: {},
        status: 200,
        statusText: 'OK',
      } as unknown as AxiosResponse<Record<string, unknown>>)
      const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)
      const accessor = service as unknown as { getAccessToken: () => Promise<unknown> }
      const value = await accessor.getAccessToken()
      expect(value).toEqual({ expires_in: undefined, token: 'raw' })
    })
  })
})
