import axios from 'axios'

import type { ISecretManager } from '../../platform/secrets/ISecretManager'

import { PixQrDecoder } from '../../modules/payments/infrastructure/paymentProviders/PixQrDecoder'
import { createMockLogger, MockLogger } from '../setup/mockFactories'

jest.mock('axios')

describe('PixQrDecoder', () => {
  let secretManager: ISecretManager
  let logger: MockLogger
  const isAxiosErrorMock = axios.isAxiosError as jest.MockedFunction<typeof axios.isAxiosError>
  const postMock = axios.post as jest.MockedFunction<typeof axios.post>

  beforeEach(() => {
    jest.clearAllMocks()
    isAxiosErrorMock.mockReset()
    isAxiosErrorMock.mockImplementation(() => false)
    secretManager = {
      getSecret: jest.fn(async (key: string) => `secret-${key.toLowerCase()}`),
      getSecrets: jest.fn(async (keys: ReadonlyArray<string>) => {
        const result: Record<string, string> = {}
        keys.forEach((k) => {
          result[k] = `val-${k.toLowerCase()}`
        })
        return result as Record<(typeof keys)[number], string>
      }),
    }
    logger = createMockLogger()
  })

  it('decodes a PIX QR code and normalizes response', async () => {
    postMock
      .mockResolvedValueOnce({ data: { access_token: 'token-123', expires_in: 900 } })
      .mockResolvedValueOnce({
        data: {
          amount: 25.5,
          brCode: { keyId: 'pix-key' },
          name: 'Alice',
          taxId: '123',
        },
      })

    const decoder = new PixQrDecoder(secretManager, logger)
    const decoded = await decoder.decode('qr-123')

    expect(decoded).toEqual({
      account: 'pix-key',
      amount: '25.50',
      currency: 'BRL',
      name: 'Alice',
      taxId: '123',
    })
    expect(postMock).toHaveBeenCalledTimes(2)
  })

  it('returns null when taxId is masked and reuses cached token', async () => {
    postMock.mockResolvedValueOnce({ data: { access_token: 'token-abc', expires_in: 3600 } })
    postMock.mockResolvedValueOnce({
      data: {
        amount: 10,
        brCode: { keyId: 'k' },
        name: 'Bob',
        taxId: '****1234',
      },
    })
    const decoder = new PixQrDecoder(secretManager, logger)
    await decoder.decode('first')

    // Cached token should bypass another auth call
    postMock.mockResolvedValueOnce({
      data: {
        amount: 5,
        brCode: { keyId: 'k2' },
        name: 'Carol',
        taxId: '****5678',
      },
    })

    const decoded = await decoder.decode('second')

    expect(decoded?.taxId).toBeNull()
    expect(postMock).toHaveBeenCalledTimes(3)
  })

  it('returns null on errors', async () => {
    postMock.mockRejectedValueOnce(new Error('network'))
    const decoder = new PixQrDecoder(secretManager, logger)

    const decoded = await decoder.decode('bad')

    expect(decoded).toBeNull()
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('Transfero Pix QR decode failed', 'network')
  })

  describe('describeError', () => {
    it('handles axios responses with strings, objects, and circular payloads', () => {
      const decoder = new PixQrDecoder(secretManager, logger)
      const describe = decoder as unknown as { describeError: (err: unknown) => string }

      isAxiosErrorMock.mockReturnValueOnce(true)
      const stringResponse: unknown = { message: 'string resp', response: { data: 'failure' } }
      expect(describe.describeError(stringResponse)).toBe('failure')

      isAxiosErrorMock.mockReturnValueOnce(true)
      const objectResponse: unknown = { message: 'object resp', response: { data: { code: 400 } } }
      expect(describe.describeError(objectResponse)).toBe(JSON.stringify({ code: 400 }))

      isAxiosErrorMock.mockReturnValueOnce(true)
      const circularPayload: Record<string, unknown> = {}
      circularPayload.self = circularPayload
      const circularResponse: unknown = { message: 'circular', response: { data: circularPayload } }
      expect(describe.describeError(circularResponse)).toBe('circular')
    })

    it('falls back cleanly for non-Axios errors and unserializable objects', () => {
      const decoder = new PixQrDecoder(secretManager, logger)
      const describe = decoder as unknown as { describeError: (err: unknown) => string }

      isAxiosErrorMock.mockReturnValueOnce(false)
      expect(describe.describeError(new Error('plain'))).toBe('plain')

      isAxiosErrorMock.mockReturnValueOnce(false)
      expect(describe.describeError('text error')).toBe('text error')

      isAxiosErrorMock.mockReturnValueOnce(false)
      const circular: Record<string, unknown> = {}
      circular.self = circular
      expect(describe.describeError(circular)).toBe('[object Object]')
    })
  })
})
