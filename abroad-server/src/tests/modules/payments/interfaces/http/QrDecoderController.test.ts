import type { IPixQrDecoder, PixDecoded } from '../../../../../modules/payments/application/contracts/IQrDecoder'

import { QrDecoderController } from '../../../../../modules/payments/interfaces/http/QrDecoderController'

describe('QrDecoderController', () => {
  let decoder: IPixQrDecoder
  let badRequest: jest.Mock
  let tooManyRequests: jest.Mock
  let badGateway: jest.Mock
  let controller: QrDecoderController

  const sampleDecoded: PixDecoded = {
    account: 'BR12345',
    amount: '100.00',
    currency: 'BRL',
    name: 'Test Merchant',
    taxId: '123.456.789-00',
  }

  const decode = (qrCode: string): Promise<unknown> => controller.decodeQrCodeBR(
    badRequest as never,
    qrCode,
    tooManyRequests as never,
    badGateway as never,
  )

  beforeEach(() => {
    decoder = {
      decode: jest.fn(),
      validateForPayment: jest.fn(),
    }
    const responder = (status: number, payload: { reason: string }) => ({ status, ...payload })
    badRequest = jest.fn(responder)
    tooManyRequests = jest.fn(responder)
    badGateway = jest.fn(responder)
    controller = new QrDecoderController(decoder)
  })

  it('returns 400 for missing or invalid QR codes', async () => {
    await expect(decode('')).resolves.toEqual({ reason: 'Invalid QR Code provided', status: 400 })
    expect(badRequest).toHaveBeenCalledWith(400, { reason: 'Invalid QR Code provided' })
  })

  it('returns decoded payloads when the preview succeeds', async () => {
    ;(decoder.validateForPayment as jest.Mock).mockResolvedValue({
      decoded: sampleDecoded,
      success: true,
    })

    await expect(decode('valid-qr-code')).resolves.toEqual({ decoded: sampleDecoded })
  })

  it('answers a provider throttle with 429 and a Retry-After so callers back off', async () => {
    ;(decoder.validateForPayment as jest.Mock).mockResolvedValue({
      code: 'retriable',
      reason: 'Transfero Ultra request failed: RATE_LIMIT_EXCEEDED',
      success: false,
    })
    const setHeader = jest.spyOn(controller, 'setHeader')

    await expect(decode('qr')).resolves.toEqual({
      reason: 'The payment provider is busy. Retry in a moment.',
      status: 429,
    })
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '2')
  })

  it('answers a broken provider with 502 rather than blaming the QR code', async () => {
    ;(decoder.validateForPayment as jest.Mock).mockResolvedValue({
      code: 'permanent',
      reason: 'transfero_ultra_qr_preview_schema_mismatch',
      success: false,
    })

    await expect(decode('qr')).resolves.toEqual({
      reason: 'We could not reach the payment provider to check this QR code.',
      status: 502,
    })
  })

  it('still reports an unusable QR code as a null decode', async () => {
    ;(decoder.validateForPayment as jest.Mock).mockResolvedValue({
      code: 'validation',
      reason: 'pix_qr_not_payable:EXPIRED',
      success: false,
    })

    await expect(decode('qr')).resolves.toEqual({ decoded: null })
  })

  it('returns decoder error messages to the client', async () => {
    ;(decoder.validateForPayment as jest.Mock).mockRejectedValue(new Error('decode failed'))

    await expect(decode('qr')).resolves.toEqual({ reason: 'decode failed', status: 400 })
  })

  it('falls back to a generic message on unknown errors', async () => {
    ;(decoder.validateForPayment as jest.Mock).mockRejectedValue('bad data')

    await expect(decode('qr')).resolves.toEqual({
      reason: 'An unknown error occurred during decoding',
      status: 400,
    })
  })
})
