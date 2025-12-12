import 'reflect-metadata'

import { createMoviiService, mockedAxios, resetAxiosMocks } from './moviiPaymentService.fixtures'

describe('MoviiPaymentService payments', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAxiosMocks()
    global.fetch = jest.fn()
  })

  it('starts onboarding and handles provider errors', async () => {
    const service = createMoviiService()
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')

    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 0 } } })
    const success = await service.onboardUser({ account: '3001234567' })
    expect(success).toEqual({
      message: 'Onboarding started successfully, please make sure the user completes the onboarding process',
      success: true,
    })

    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 1 } } })
    const rejected = await service.onboardUser({ account: '3001234567' })
    expect(rejected).toEqual({ success: false })

    mockedAxios.post.mockRejectedValueOnce(new Error('timeout'))
    const failure = await service.onboardUser({ account: '3001234567' })
    expect(failure).toEqual({ success: false })
  })

  it('reads liquidity and falls back to zero on failure', async () => {
    const service = createMoviiService()
    mockedAxios.get.mockResolvedValueOnce({ data: { body: [{ saldo: '1000.50' }], statusCode: 200 } })

    const liquidity = await service.getLiquidity()
    expect(liquidity).toBeCloseTo(1000.5)

    mockedAxios.get.mockRejectedValueOnce(new Error('network down'))
    const fallback = await service.getLiquidity()
    expect(fallback).toBe(0)
  })

  it('aborts sendPayment when signer handle is missing', async () => {
    const service = createMoviiService()
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    jest.spyOn(service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> }, 'getSignerHandle')
      .mockResolvedValueOnce(null)

    const result = await service.sendPayment({ account: '3001234567', bankCode: '123', id: 'txn-1', value: 10 })
    expect(result).toEqual({ success: false })
  })

  it('sends payments and waits for transaction finalization', async () => {
    const service = createMoviiService()
    jest.spyOn(service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> }, 'getSignerHandle')
      .mockResolvedValue('$handle')
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    jest.spyOn(service as unknown as { waitForTransaction: (id: string) => Promise<{ status: string }> }, 'waitForTransaction')
      .mockResolvedValue({ status: 'COMPLETED' })
    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 0 }, transferId: 'transfer-1' } })

    const response = await service.sendPayment({ account: '3001234567', bankCode: '123', id: 'txn-2', value: 25 })
    expect(response).toEqual({ success: true, transactionId: 'transfer-1' })
  })

  it('returns failure when provider rejects the transfer', async () => {
    const service = createMoviiService()
    jest.spyOn(service as unknown as { getSignerHandle: (wallet: string, bankCode: string) => Promise<null | string> }, 'getSignerHandle')
      .mockResolvedValue('$handle')
    jest.spyOn(service as unknown as { getToken: () => Promise<string> }, 'getToken').mockResolvedValue('token-123')
    mockedAxios.post.mockResolvedValueOnce({ data: { error: { code: 2 }, transferId: null } })

    const response = await service.sendPayment({ account: '3001234567', bankCode: '123', id: 'txn-3', value: 25 })
    expect(response).toEqual({ success: false })
  })

  it('handles downstream errors gracefully and logs rejected transactions', async () => {
    const service = createMoviiService()
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
})
