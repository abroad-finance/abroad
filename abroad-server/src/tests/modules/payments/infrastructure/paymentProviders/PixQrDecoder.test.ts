import 'reflect-metadata'

import { PixQrDecoder } from '../../../../../modules/payments/infrastructure/paymentProviders/PixQrDecoder'
import { TransferoUltraClient, TransferoUltraError } from '../../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { createMockLogger } from '../../../../setup/mockFactories'

type UltraClientMock = jest.Mocked<
  Pick<TransferoUltraClient, 'get' | 'patch' | 'post'>
>

const createUltraClient = (): UltraClientMock => ({
  get: jest.fn(),
  patch: jest.fn(),
  post: jest.fn(),
})

const payablePreview = {
  amount: 25.5,
  currency: '986',
  merchantCity: 'SAO PAULO',
  merchantName: 'Alice',
  pixKey: 'pix-key',
  status: 'created',
  txid: 'tx-123',
  type: 'dynamic' as const,
  url: 'https://pix.example/tx-123',
}

describe('PixQrDecoder', () => {
  it('previews a payable Ultra BR code and normalizes the public result', async () => {
    const ultraClient = createUltraClient()
    ultraClient.post.mockResolvedValue(payablePreview)
    const decoder = new PixQrDecoder(
      ultraClient as unknown as TransferoUltraClient,
      createMockLogger(),
    )

    const result = await decoder.validateForPayment({
      idempotencyKey: 'abroad:pix-preview:transaction-1',
      qrCode: 'br-code',
    })

    expect(result).toEqual({
      decoded: {
        account: 'pix-key',
        amount: '25.50',
        currency: 'BRL',
        name: 'Alice',
        taxId: null,
      },
      success: true,
    })
    expect(ultraClient.post).toHaveBeenCalledWith(
      '/api/v1/pix/brcode-previews',
      { brcode: 'br-code' },
      'abroad:pix-preview:transaction-1',
      { interactive: true },
    )
  })

  it('accepts a preview Ultra resolves without a PIX key', async () => {
    const ultraClient = createUltraClient()
    const logger = createMockLogger()
    ultraClient.post.mockResolvedValue({ ...payablePreview, pixKey: null })
    const decoder = new PixQrDecoder(
      ultraClient as unknown as TransferoUltraClient,
      logger,
    )

    await expect(decoder.validateForPayment({
      idempotencyKey: 'preview-no-key',
      qrCode: 'keyless-code',
    })).resolves.toEqual({
      decoded: {
        account: undefined,
        amount: '25.50',
        currency: 'BRL',
        name: 'Alice',
        taxId: null,
      },
      success: true,
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('accepts a static QR preview when Ultra has no charge status', async () => {
    const ultraClient = createUltraClient()
    ultraClient.post.mockResolvedValue({
      ...payablePreview,
      status: null,
      txid: null,
      type: 'static',
      url: null,
    })
    const decoder = new PixQrDecoder(
      ultraClient as unknown as TransferoUltraClient,
      createMockLogger(),
    )

    await expect(decoder.validateForPayment({
      idempotencyKey: 'preview-static',
      qrCode: 'static-code',
    })).resolves.toEqual({
      decoded: {
        account: 'pix-key',
        amount: '25.50',
        currency: 'BRL',
        name: 'Alice',
        taxId: null,
      },
      success: true,
    })
  })

  it('rejects a dynamic QR with no status as validation, not a schema mismatch', async () => {
    const ultraClient = createUltraClient()
    const logger = createMockLogger()
    ultraClient.post.mockResolvedValue({
      ...payablePreview,
      status: null,
    })
    const decoder = new PixQrDecoder(
      ultraClient as unknown as TransferoUltraClient,
      logger,
    )

    await expect(decoder.validateForPayment({
      idempotencyKey: 'preview-dynamic-status-unavailable',
      qrCode: 'dynamic-code',
    })).resolves.toEqual({
      code: 'validation',
      reason: 'pix_qr_not_payable:STATUS_UNAVAILABLE',
      success: false,
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('rejects a non-payable QR status without accepting legacy status aliases', async () => {
    const ultraClient = createUltraClient()
    ultraClient.post.mockResolvedValue({
      ...payablePreview,
      status: 'expired',
    })
    const decoder = new PixQrDecoder(
      ultraClient as unknown as TransferoUltraClient,
      createMockLogger(),
    )

    await expect(decoder.validateForPayment({
      idempotencyKey: 'preview-2',
      qrCode: 'expired-code',
    })).resolves.toEqual({
      code: 'validation',
      reason: 'pix_qr_not_payable:EXPIRED',
      success: false,
    })
    await expect(decoder.decode('expired-code')).resolves.toBeNull()
  })

  it('rejects currencies outside BRL and ISO-4217 numeric code 986', async () => {
    const ultraClient = createUltraClient()
    ultraClient.post.mockResolvedValue({
      ...payablePreview,
      currency: 'USD',
    })
    const decoder = new PixQrDecoder(
      ultraClient as unknown as TransferoUltraClient,
      createMockLogger(),
    )

    await expect(decoder.validateForPayment({
      idempotencyKey: 'preview-3',
      qrCode: 'foreign-code',
    })).resolves.toEqual({
      code: 'validation',
      reason: 'pix_qr_currency_not_supported:USD',
      success: false,
    })
  })

  it('preserves Ultra transport failure classification', async () => {
    const ultraClient = createUltraClient()
    ultraClient.post.mockRejectedValue(new TransferoUltraError({
      code: 'retriable',
      message: 'Transfero Ultra RATE_LIMIT',
      providerCode: 'RATE_LIMIT',
      status: 429,
    }))
    const decoder = new PixQrDecoder(
      ultraClient as unknown as TransferoUltraClient,
      createMockLogger(),
    )

    await expect(decoder.validateForPayment({
      idempotencyKey: 'preview-4',
      qrCode: 'code',
    })).resolves.toEqual({
      code: 'retriable',
      reason: 'Transfero Ultra RATE_LIMIT',
      success: false,
    })
  })

  it('fails permanently when the Ultra response violates its schema', async () => {
    const ultraClient = createUltraClient()
    const logger = createMockLogger()
    ultraClient.post.mockResolvedValue({
      currency: '986',
      status: 'created',
    })
    const decoder = new PixQrDecoder(
      ultraClient as unknown as TransferoUltraClient,
      logger,
    )

    await expect(decoder.validateForPayment({
      idempotencyKey: 'preview-5',
      qrCode: 'code',
    })).resolves.toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_qr_preview_schema_mismatch',
      success: false,
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Transfero Ultra PIX QR preview schema mismatch'),
      expect.objectContaining({ issues: expect.any(Array) }),
    )
  })
})
