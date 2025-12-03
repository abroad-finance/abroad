import 'reflect-metadata'
import { TargetCurrency } from '@prisma/client'
import axios, { type AxiosResponse } from 'axios'

import type { ILogger } from '../../interfaces'
import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IPixQrDecoder } from '../../interfaces/IQrDecoder'
import type { ISecretManager } from '../../interfaces/ISecretManager'

import { TransferoPaymentService } from '../../services/paymentServices/transferoPaymentService'

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
  let logger: ILogger

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
    logger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }
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
      expect(brazilian[0]).toMatchObject({ pixKey: '+55021987654321', taxId: 'TAX-ABC' })

      const foreign = await builder.buildContract({
        account: 'user@example.com',
        qrCode: null,
        taxId: 'TAX-ABC',
        value: 75,
      })
      expect(foreign[0]).toMatchObject({ pixKey: 'user@example.com' })
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
  })
})
