import type { IPixQrDecoder, PixDecoded } from '../../interfaces/IQrDecoder'

import { QrDecoderController } from '../../controllers/QrDecoderController'

describe('QrDecoderController', () => {
  let decoder: IPixQrDecoder
  let badRequest: jest.Mock
  let controller: QrDecoderController

  const sampleDecoded: PixDecoded = {
    account: 'BR12345',
    amount: '100.00',
    currency: 'BRL',
    name: 'Test Merchant',
    taxId: '123.456.789-00',
  }

  beforeEach(() => {
    decoder = {
      decode: jest.fn(),
    }
    badRequest = jest.fn((status: number, payload: { reason: string }) => ({ status, ...payload }))
    controller = new QrDecoderController(decoder)
  })

  it('returns 400 for missing or invalid QR codes', async () => {
    const response = await controller.decodeQrCodeBR(badRequest, '')

    expect(response).toEqual({ reason: 'Invalid QR Code provided', status: 400 })
    expect(badRequest).toHaveBeenCalledWith(400, { reason: 'Invalid QR Code provided' })
  })

  it('returns decoded payloads when the decoder succeeds', async () => {
    ;(decoder.decode as jest.Mock).mockResolvedValue(sampleDecoded)

    const response = await controller.decodeQrCodeBR(badRequest, 'valid-qr-code')

    expect(response).toEqual({ decoded: sampleDecoded })
  })

  it('returns decoder error messages to the client', async () => {
    ;(decoder.decode as jest.Mock).mockRejectedValue(new Error('decode failed'))

    const response = await controller.decodeQrCodeBR(badRequest, 'qr')

    expect(response).toEqual({ reason: 'decode failed', status: 400 })
  })

  it('falls back to a generic message on unknown errors', async () => {
    ;(decoder.decode as jest.Mock).mockRejectedValue('bad data')

    const response = await controller.decodeQrCodeBR(badRequest, 'qr')

    expect(response).toEqual({ reason: 'An unknown error occurred during decoding', status: 400 })
  })
})
