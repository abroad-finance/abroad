import 'reflect-metadata'
import { type AxiosResponse } from 'axios'

import { TransferoPaymentService } from '../../services/paymentServices/transferoPaymentService'
import { buildTransferoHarness, mockedAxios, resetAxiosMocks } from './transferoPaymentService.fixtures'

jest.mock('axios')

afterEach(() => {
  jest.restoreAllMocks()
  resetAxiosMocks()
})

describe('TransferoPaymentService access tokens and helpers', () => {
  it('caches the token until nearly expired', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const { tokenAccessor } = buildTransferoHarness()

    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'token-1', expires_in: 120 },
    } as AxiosResponse<{ access_token: string, expires_in: number }>)

    const first = await tokenAccessor.getAccessToken()
    nowSpy.mockReturnValue(1_020_000)
    const second = await tokenAccessor.getAccessToken()
    nowSpy.mockRestore()

    expect(first).toBe('token-1')
    expect(second).toBe('token-1')
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  })

  it('refreshes expired tokens and falls back when QR decoding lacks data', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)
    const { contractBuilder, pixDecoder, tokenAccessor } = buildTransferoHarness({
      pixDecoder: { decode: jest.fn(async () => null) },
    })
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'fresh', expires_in: 1 },
    } as AxiosResponse<{ access_token: string, expires_in: number }>)

    const first = await tokenAccessor.getAccessToken()
    nowSpy.mockReturnValue(2_000)
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'refreshed', expires_in: 900 },
    } as AxiosResponse<{ access_token: string, expires_in: number }>)
    const second = await tokenAccessor.getAccessToken()
    nowSpy.mockRestore()

    expect(first).toBe('fresh')
    expect(second).toBe('refreshed')
    const contract = await contractBuilder.buildContract({
      account: 'abc-123',
      qrCode: 'qr-without-data',
      taxId: 'FALLBACK',
      value: 99,
    })
    expect(pixDecoder.decode).toHaveBeenCalledWith('qr-without-data')
    expect(contract[0]).toMatchObject({ name: 'Recipient', taxId: 'FALLBACK' })
  })

  it('reuses cached tokens and exercises phone normalization edge cases', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)
    const { contractBuilder, tokenAccessor } = buildTransferoHarness()
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'cached', expires_in: 900 },
    } as AxiosResponse<{ access_token: string, expires_in: number }>)
    const first = await tokenAccessor.getAccessToken()
    nowSpy.mockReturnValue(1_000)
    const second = await tokenAccessor.getAccessToken()
    nowSpy.mockRestore()

    expect(first).toBe(second)

    const emptyDigits = await contractBuilder.buildContract({
      account: '---',
      qrCode: null,
      taxId: 'T',
      value: 1,
    })
    expect(emptyDigits[0]).toMatchObject({ pixKey: '---' })

    const nullInput = await contractBuilder.buildContract({
      account: null as unknown as string,
      qrCode: null,
      taxId: 'T',
      value: 1,
    })
    expect(nullInput[0]).toMatchObject({ pixKey: null })

    const invalidLandline = await contractBuilder.buildContract({
      account: '1199999999',
      qrCode: null,
      taxId: 'T',
      value: 1,
    })
    expect(invalidLandline[0]).toMatchObject({ pixKey: '1199999999' })
  })

  it('handles token responses without access_token or expiry', async () => {
    const { tokenAccessor } = buildTransferoHarness()
    mockedAxios.post.mockResolvedValueOnce({
      config: { headers: {} },
      data: { expires_in: undefined, token: 'raw' },
      headers: {},
      status: 200,
      statusText: 'OK',
    } as unknown as AxiosResponse<Record<string, unknown>>)

    const value = await tokenAccessor.getAccessToken()
    expect(value).toEqual({ expires_in: undefined, token: 'raw' })
  })

  it('parses amounts and enforces expected currency when extracting liquidity', () => {
    const parser = TransferoPaymentService as unknown as {
      parseAmount: (raw: number | string | undefined) => null | number
    }
    expect(parser.parseAmount(25)).toBe(25)
    expect(parser.parseAmount(' 1.250,40 ')).toBeCloseTo(1250.40)
    expect(parser.parseAmount('not-a-number')).toBeNull()
    expect(parser.parseAmount(undefined)).toBeNull()

    const harness = buildTransferoHarness()
    const extractor = harness.service as unknown as {
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
