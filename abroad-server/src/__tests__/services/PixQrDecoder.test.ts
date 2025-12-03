import axios from 'axios'

import type { ISecretManager } from '../../interfaces/ISecretManager'

import { PixQrDecoder } from '../../services/PixQrDecoder'

jest.mock('axios')

describe('PixQrDecoder', () => {
  let secretManager: ISecretManager
  const postMock = axios.post as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
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

    const decoder = new PixQrDecoder(secretManager)
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
    const decoder = new PixQrDecoder(secretManager)
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
    const decoder = new PixQrDecoder(secretManager)

    const decoded = await decoder.decode('bad')

    expect(decoded).toBeNull()
  })
})
