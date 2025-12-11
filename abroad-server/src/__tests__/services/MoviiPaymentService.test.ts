import 'reflect-metadata'
import axios from 'axios'

import type { ISecretManager } from '../../interfaces/ISecretManager'

import { MoviiPaymentService } from '../../services/paymentServices/movii'
import { createMockLogger } from '../setup/mockFactories'

jest.mock('axios')

const mockedAxios = axios as unknown as jest.MockedFunction<typeof axios> & {
  get: jest.Mock
  post: jest.Mock
}

const buildSecretManager = (): ISecretManager => {
  const secrets: Record<string, string> = {
    MOVII_API_KEY: 'api-key',
    MOVII_BALANCE_ACCOUNT_ID: 'account-1',
    MOVII_BALANCE_API_KEY: 'balance-key',
    MOVII_BASE_URL: 'https://movii.example.com',
    MOVII_CLIENT_ID: 'client-id',
    MOVII_CLIENT_SECRET: 'client-secret',
    MOVII_SIGNER_HANDLER: '$handler',
  }

  return {
    getSecret: jest.fn(async (name: string) => secrets[name] ?? ''),
    getSecrets: jest.fn(async (names: readonly string[]) => {
      const result: Record<string, string> = {}
      names.forEach((name) => {
        result[name] = secrets[name] ?? ''
      })
      return result as Record<typeof names[number], string>
    }),
  }
}

describe('MoviiPaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAxios.mockReset()
    mockedAxios.get = jest.fn()
    mockedAxios.post = jest.fn()
    global.fetch = jest.fn()
  })

  it('starts onboarding and handles provider errors', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')

    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 0 } } })
    const success = await service.onboardUser({ account: '3001234567' })
    expect(success).toEqual({
      message: 'Onboarding started successfully, please make sure the user completes the onboarding process',
      success: true,
    })
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://movii.example.com/transfiya/v2/transfers',
      expect.objectContaining({
        amount: '1000',
        labels: expect.objectContaining({
          acceptSms: expect.stringContaining('transfiya'),
          sourceChannel: 'APP',
          transactionPurpose: 'ONBOARDING',
          type: 'SEND',
        }),
        source: '$handler',
        target: '$573001234567',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'api-key' }),
      }),
    )

    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 1 } } })
    const rejected = await service.onboardUser({ account: '3001234567' })
    expect(rejected).toEqual({ success: false })

    mockedAxios.post.mockRejectedValueOnce(new Error('timeout'))
    const failure = await service.onboardUser({ account: '3001234567' })
    expect(failure).toEqual({ success: false })
  })

  it('reads liquidity and falls back to zero on failure', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    mockedAxios.get.mockResolvedValueOnce({ data: { body: [{ saldo: '1000.50' }], statusCode: 200 } })

    const liquidity = await service.getLiquidity()
    expect(liquidity).toBeCloseTo(1000.5)

    mockedAxios.get.mockRejectedValueOnce(new Error('network down'))
    const fallback = await service.getLiquidity()
    expect(fallback).toBe(0)
  })

  it('aborts sendPayment when signer handle is missing', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    jest.spyOn(service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> }, 'getSignerHandle')
      .mockResolvedValueOnce(null)

    const result = await service.sendPayment({ account: '3001234567', bankCode: '123', id: 'txn-1', value: 10 })
    expect(result).toEqual({ success: false })
  })

  it('sends payments and waits for transaction finalization', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    jest.spyOn(service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> }, 'getSignerHandle')
      .mockResolvedValue('$handle')
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    jest.spyOn(service as unknown as { waitForTransaction: (id: string) => Promise<{ status: string }> }, 'waitForTransaction')
      .mockResolvedValue({ status: 'COMPLETED' })
    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 0 }, transferId: 'transfer-1' } })

    const response = await service.sendPayment({ account: '3001234567', bankCode: '123', id: 'txn-2', value: 25 })
    expect(response).toEqual({ success: true, transactionId: 'transfer-1' })
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://movii.example.com/transfiya/v2/transfers',
      expect.objectContaining({
        amount: '25',
        labels: expect.objectContaining({
          description: 'Abroad transfer',
          transactionPurpose: 'TRANSFER',
          type: 'SEND',
        }),
        source: '$handler',
        target: '$handle',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'api-key' }),
      }),
    )
  })

  it('returns failure when provider rejects the transfer', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    jest.spyOn(service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> }, 'getSignerHandle')
      .mockResolvedValue('$handle')
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 2 }, transferId: null } })

    const response = await service.sendPayment({ account: '3001234567', bankCode: '123', id: 'txn-3', value: 25 })
    expect(response).toEqual({ success: false })
  })

  it('handles downstream errors gracefully and logs rejected transactions', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    jest.spyOn(service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> }, 'getSignerHandle')
      .mockResolvedValue('$handle')
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    jest.spyOn(service as unknown as { waitForTransaction: (id: string) => Promise<{ status: string }> }, 'waitForTransaction')
      .mockResolvedValue({ status: 'REJECTED' })

    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 0 }, transferId: 'transfer-3' } })
    const rejected = await service.sendPayment({ account: '3001234567', bankCode: '123', id: 'txn-4', value: 25 })
    expect(rejected).toEqual({ success: false })

    mockedAxios.post.mockRejectedValueOnce(new Error('api down'))
    const caught = await service.sendPayment({ account: '3001234567', bankCode: '123', id: 'txn-5', value: 25 })
    expect(caught).toEqual({ success: false })
  })

  it('verifies accounts and propagates fetch failures', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({
        entities: [{ bankBicfi: '123', handle: '$handle' }],
        error: { code: 0 },
      }),
    })

    const signer = await (service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> })
      .getSignerHandle('3001234567', '123')
    expect(signer).toBe('$handle')

    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ error: { code: 1, message: 'bad request' } }),
    })
    await expect((service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> })
      .getSignerHandle('3001234567', '123'))
      .rejects.toThrow('bad request')

    jest.spyOn(service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> }, 'getSignerHandle')
      .mockRejectedValueOnce(new Error('lookup failed'))
    const verified = await service.verifyAccount({ account: '3001234567', bankCode: '123' })
    expect(verified).toBe(false)
  })

  it('polls transaction status until completion', async () => {
    jest.useFakeTimers()
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    mockedAxios.get
      .mockResolvedValueOnce({ data: { entities: [{ status: 'PENDING' }] } })
      .mockResolvedValueOnce({ data: { entities: [{ status: 'COMPLETED' }] } })

    const waiter = service as unknown as { waitForTransaction: (id: string) => Promise<{ status: string }> }
    const promise = waiter.waitForTransaction('transfer-2')
    await jest.runOnlyPendingTimersAsync()
    const result = await promise
    expect(result.status).toBe('COMPLETED')
    jest.useRealTimers()
  })

  it('throws when token retrieval fails and when polling times out', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    mockedAxios.post.mockRejectedValueOnce(new Error('auth down'))
    await expect((service as unknown as { getToken: () => Promise<string> }).getToken()).rejects.toThrow('auth down')

    jest.useFakeTimers()
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockImplementationOnce(() => start).mockImplementation(() => start + 301_000)
    mockedAxios.get.mockRejectedValue(new Error('network'))

    const waiter = service as unknown as { waitForTransaction: (id: string) => Promise<{ status: string }> }
    await expect(waiter.waitForTransaction('transfer-4')).rejects.toThrow('Timeout waiting for transaction to complete')
    jest.useRealTimers()
    nowSpy.mockRestore()
  })

  it('retrieves an auth token successfully', async () => {
    const service = new MoviiPaymentService(buildSecretManager(), createMockLogger())
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-success' } })

    const token = await (service as unknown as { getToken: () => Promise<string> }).getToken()
    expect(token).toBe('token-success')
  })
})
