import 'reflect-metadata'

import { createMoviiService, mockedAxios, resetAxiosMocks } from './moviiPaymentService.fixtures'

describe('MoviiPaymentService auth and lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAxiosMocks()
    global.fetch = jest.fn()
  })

  it('verifies accounts and propagates fetch failures', async () => {
    const service = createMoviiService()
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
    const service = createMoviiService()
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
    const service = createMoviiService()
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
    const service = createMoviiService()
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-success' } })

    const token = await (service as unknown as { getToken: () => Promise<string> }).getToken()
    expect(token).toBe('token-success')
  })
})
