import 'reflect-metadata'
import axios from 'axios'

import type { ISecretManager } from '../../../../../platform/secrets/ISecretManager'

import { NequiPaymentService } from '../../../../../modules/payments/infrastructure/paymentProviders/nequi'
import { createMockLogger } from '../../../../setup/mockFactories'

jest.mock('axios')

const mockedAxios = axios as unknown as jest.MockedFunction<typeof axios>

const buildSecrets = (): ISecretManager => {
  const defaults: Record<string, string> = {
    ACCESS_KEY_NEQUI: 'access',
    API_KEY_NEQUI: 'api-key',
    DISPERSION_CODE_NEQUI: 'code',
    SECRET_KEY_NEQUI: 'secret',
    URL_NEQUI: 'https://nequi.example.com',
    URL_NEQUI_AUTH: 'https://nequi.example.com/auth',
  }
  return {
    getSecret: jest.fn(async (name: string) => defaults[name] ?? ''),
    getSecrets: jest.fn(async (names: readonly string[]) => {
      const result: Record<string, string> = {}
      names.forEach((name) => {
        result[name] = defaults[name] ?? ''
      })
      return result as Record<typeof names[number], string>
    }),
  }
}

describe('NequiPaymentService', () => {
  beforeEach(() => {
    jest.useRealTimers()
    mockedAxios.mockReset()
  })

  it('caches auth tokens and rejects failed auth responses', async () => {
    const secretManager = buildSecrets()
    const service = new NequiPaymentService(secretManager, createMockLogger())
    mockedAxios.mockResolvedValueOnce({
      data: { access_token: 'token-1', expires_in: 120 },
      status: 200,
    })

    const first = await (service as unknown as { getAuthToken: () => Promise<string> }).getAuthToken()
    expect(first).toBe('token-1')
    expect(mockedAxios).toHaveBeenCalledTimes(1)

    // Cached token should be used until near expiration
    const second = await (service as unknown as { getAuthToken: () => Promise<string> }).getAuthToken()
    expect(second).toBe('token-1')
    expect(mockedAxios).toHaveBeenCalledTimes(1)

    const freshService = new NequiPaymentService(secretManager, createMockLogger())
    mockedAxios.mockResolvedValueOnce({ data: {}, status: 500 })
    await expect((freshService as unknown as { getAuthToken: () => Promise<string> }).getAuthToken())
      .rejects.toThrow('Nequi authentication failed')
  })

  it('sends payments and interprets provider responses', async () => {
    const secretManager = buildSecrets()
    const service = new NequiPaymentService(secretManager, createMockLogger())
    const makeRequest = jest.spyOn(service as unknown as { makeRequest: (endpoint: string, body: Record<string, unknown>) => Promise<unknown> }, 'makeRequest')

    makeRequest.mockResolvedValueOnce({
      ResponseMessage: {
        ResponseBody: { any: {} },
        ResponseHeader: {
          Channel: 'channel',
          ClientID: 'client',
          Destination: {
            ServiceName: 'DispersionService',
            ServiceOperation: 'disperseFunds',
            ServiceRegion: 'C001',
            ServiceVersion: '1.0.0',
          },
          MessageID: 'msg-1',
          ResponseDate: new Date().toISOString(),
          Status: { StatusCode: '0', StatusDesc: 'SUCCESS' },
        },
      },
    })

    const result = await service.sendPayment({ account: '3001234567', bankCode: 'ignored', id: 'txn-1', value: 100 })
    expect(result).toEqual({ success: true, transactionId: 'msg-1' })

    makeRequest.mockResolvedValueOnce({
      ResponseMessage: {
        ResponseBody: { any: {} },
        ResponseHeader: {
          Channel: 'channel',
          ClientID: 'client',
          Destination: {
            ServiceName: 'DispersionService',
            ServiceOperation: 'disperseFunds',
            ServiceRegion: 'C001',
            ServiceVersion: '1.0.0',
          },
          MessageID: 'msg-2',
          ResponseDate: new Date().toISOString(),
          Status: { StatusCode: '1', StatusDesc: 'DECLINED' },
        },
      },
    })
    const rejected = await service.sendPayment({ account: '3001234567', bankCode: 'ignored', id: 'txn-2', value: 50 })
    expect(rejected).toEqual({ success: false, transactionId: 'msg-2' })
  })

  it('validates provider request responses', async () => {
    const secretManager = buildSecrets()
    const service = new NequiPaymentService(secretManager, createMockLogger())
    mockedAxios.mockResolvedValueOnce({
      data: { access_token: 'token-2', expires_in: 120 },
      status: 200,
    })
    mockedAxios.mockResolvedValueOnce({ data: {}, status: 400 })
    await expect((service as unknown as { makeRequest: (endpoint: string, body: Record<string, unknown>) => Promise<unknown> })
      .makeRequest('/noop', {}))
      .rejects.toThrow('Nequi request failed: 400')
  })
})
