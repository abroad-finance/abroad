import 'reflect-metadata'

import type { IPixQrDecoder } from '../../../../../modules/payments/application/contracts/IQrDecoder'

import { TransferoPaymentService } from '../../../../../modules/payments/infrastructure/paymentProviders/transferoPaymentService'
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

const createDecoder = (): jest.Mocked<IPixQrDecoder> => ({
  decode: jest.fn(),
  validateForPayment: jest.fn(),
})

const balanceRow = (asset: string, available: string) => ({
  asset,
  available,
  blocked: '0',
  credit: '0',
  ledgerBalance: available,
  openDebt: '0',
  openWithdrawals: '0',
  overdueDebt: '0',
  owedDue: '0',
  processing: '0',
})

const withdrawalResponse = (status = 'PROCESSING') => ({
  amount: 10,
  fee: 0.1,
  feePercent: 1,
  id: '11111111-2222-4333-8444-555555555555',
  netAmount: 9.9,
  pixKey: 'user@example.com',
  requiresApproval: false,
  status,
})

const createService = () => {
  const ultraClient = createUltraClient()
  const decoder = createDecoder()
  const logger = createMockLogger()
  const service = new TransferoPaymentService(
    ultraClient as unknown as TransferoUltraClient,
    decoder,
    logger,
  )
  return { decoder, logger, service, ultraClient }
}

describe('TransferoPaymentService', () => {
  const previousDelay = process.env.TRANSFERO_ULTRA_RETRY_DELAY_MS

  beforeAll(() => {
    process.env.TRANSFERO_ULTRA_RETRY_DELAY_MS = '1'
  })

  afterAll(() => {
    if (previousDelay === undefined) {
      delete process.env.TRANSFERO_ULTRA_RETRY_DELAY_MS
    }
    else {
      process.env.TRANSFERO_ULTRA_RETRY_DELAY_MS = previousDelay
    }
  })

  it('reads the BRZ available balance as payout liquidity', async () => {
    const { service, ultraClient } = createService()
    ultraClient.get.mockResolvedValue([
      balanceRow('USDC', '50.00'),
      balanceRow('BRZ', '1234.56'),
    ])

    await expect(service.getLiquidity()).resolves.toBe(1234.56)
    expect(ultraClient.get).toHaveBeenCalledWith('/api/v1/balance')
  })

  it('returns zero when BRZ is absent or the response schema is invalid', async () => {
    const { logger, service, ultraClient } = createService()
    ultraClient.get
      .mockResolvedValueOnce([balanceRow('USDC', '50.00')])
      .mockResolvedValueOnce([{ asset: 'BRZ', available: 10 }])

    await expect(service.getLiquidity()).resolves.toBe(0)
    await expect(service.getLiquidity()).resolves.toBe(0)
    expect(logger.error).toHaveBeenCalledTimes(2)
  })

  it('submits a PIX-key withdrawal with stable header and body idempotency', async () => {
    const { service, ultraClient } = createService()
    ultraClient.post.mockResolvedValue(withdrawalResponse())

    const result = await service.sendPayment({
      account: '0 21 98765-4321',
      id: 'transaction-1',
      qrCode: null,
      value: 10,
    })

    expect(result).toEqual({
      success: true,
      transactionId: '11111111-2222-4333-8444-555555555555',
    })
    expect(ultraClient.post).toHaveBeenCalledWith(
      '/api/v1/pix/withdrawals',
      {
        amount: 10,
        description: 'Abroad payout transaction-1',
        idempotencyKey: 'abroad:pix-withdrawal:transaction-1',
        pixKey: '+5521987654321',
      },
      'abroad:pix-withdrawal:transaction-1',
    )
  })

  it('validates a BR code with a stable preview key before withdrawing', async () => {
    const { decoder, service, ultraClient } = createService()
    decoder.validateForPayment.mockResolvedValue({
      decoded: {
        account: 'pix-key',
        amount: '10.00',
        currency: 'BRL',
        status: 'CREATED',
        type: 'dynamic',
      },
      success: true,
    })
    ultraClient.post.mockResolvedValue(withdrawalResponse())

    await expect(service.sendPayment({
      account: 'ignored',
      id: 'transaction-2',
      qrCode: 'br-code',
      value: 10,
    })).resolves.toMatchObject({ success: true })

    expect(decoder.validateForPayment).toHaveBeenCalledWith({
      idempotencyKey: 'abroad:pix-preview:transaction-2',
      qrCode: 'br-code',
    })
    expect(ultraClient.post).toHaveBeenCalledWith(
      '/api/v1/pix/withdrawals',
      {
        amount: 10,
        brcode: 'br-code',
        description: 'Abroad payout transaction-2',
        idempotencyKey: 'abroad:pix-withdrawal:transaction-2',
      },
      'abroad:pix-withdrawal:transaction-2',
    )
  })

  it('does not withdraw when preview validation fails or its amount differs', async () => {
    const { decoder, service, ultraClient } = createService()
    decoder.validateForPayment
      .mockResolvedValueOnce({
        code: 'validation',
        reason: 'pix_qr_not_payable:EXPIRED',
        success: false,
      })
      .mockResolvedValueOnce({
        decoded: {
          amount: '9.00',
          currency: 'BRL',
          status: 'CREATED',
          type: 'dynamic',
        },
        success: true,
      })

    await expect(service.sendPayment({
      account: 'ignored',
      id: 'transaction-3',
      qrCode: 'expired',
      value: 10,
    })).resolves.toEqual({
      code: 'validation',
      reason: 'pix_qr_not_payable:EXPIRED',
      success: false,
    })
    await expect(service.sendPayment({
      account: 'ignored',
      id: 'transaction-4',
      qrCode: 'wrong-amount',
      value: 10,
    })).resolves.toEqual({
      code: 'validation',
      reason: 'pix_qr_amount_mismatch',
      success: false,
    })
    expect(ultraClient.post).not.toHaveBeenCalled()
  })

  it('retries only retriable Ultra failures using the same idempotency key', async () => {
    const { service, ultraClient } = createService()
    ultraClient.post
      .mockRejectedValueOnce(new TransferoUltraError({
        code: 'retriable',
        message: 'Transfero Ultra HTTP_502',
        status: 502,
      }))
      .mockResolvedValueOnce(withdrawalResponse())

    await expect(service.sendPayment({
      account: 'user@example.com',
      id: 'transaction-retry',
      value: 10,
    })).resolves.toMatchObject({ success: true })

    expect(ultraClient.post).toHaveBeenCalledTimes(2)
    expect(ultraClient.post.mock.calls[0][2]).toBe('abroad:pix-withdrawal:transaction-retry')
    expect(ultraClient.post.mock.calls[1][2]).toBe('abroad:pix-withdrawal:transaction-retry')
    expect(ultraClient.post.mock.calls[1][1]).toEqual(ultraClient.post.mock.calls[0][1])
  })

  it('does not retry validation failures and rejects terminal initial states', async () => {
    const { service, ultraClient } = createService()
    ultraClient.post
      .mockRejectedValueOnce(new TransferoUltraError({
        code: 'validation',
        message: 'Transfero Ultra INVALID_PIX_KEY',
        status: 422,
      }))
      .mockResolvedValueOnce(withdrawalResponse('FAILED'))

    await expect(service.sendPayment({
      account: 'bad-key',
      id: 'transaction-invalid',
      value: 10,
    })).resolves.toEqual({
      code: 'validation',
      reason: 'Transfero Ultra INVALID_PIX_KEY',
      success: false,
    })
    await expect(service.sendPayment({
      account: 'user@example.com',
      id: 'transaction-terminal',
      value: 10,
    })).resolves.toEqual({
      code: 'permanent',
      reason: 'pix_withdrawal_created_in_terminal_state:FAILED',
      success: false,
    })
    expect(ultraClient.post).toHaveBeenCalledTimes(2)
  })

  it('fails permanently on a malformed withdrawal response', async () => {
    const { service, ultraClient } = createService()
    ultraClient.post.mockResolvedValue({ id: 'not-a-uuid', status: 'paid' })

    await expect(service.sendPayment({
      account: 'user@example.com',
      id: 'transaction-schema',
      value: 10,
    })).resolves.toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_withdrawal_schema_mismatch',
      success: false,
    })
  })

  it('fails closed when an idempotent withdrawal response has a different amount', async () => {
    const { service, ultraClient } = createService()
    ultraClient.post.mockResolvedValue({
      ...withdrawalResponse(),
      amount: 11,
    })

    await expect(service.sendPayment({
      account: 'user@example.com',
      id: 'transaction-collision',
      value: 10,
    })).resolves.toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_withdrawal_amount_mismatch',
      success: false,
    })
  })

  it('rejects values below Ultra minimum and empty PIX keys locally', async () => {
    const { service, ultraClient } = createService()

    await expect(service.sendPayment({
      account: 'user@example.com',
      id: 'too-small',
      value: 0.99,
    })).resolves.toMatchObject({
      code: 'validation',
      success: false,
    })
    await expect(service.sendPayment({
      account: '   ',
      id: 'missing-key',
      value: 1,
    })).resolves.toMatchObject({
      code: 'validation',
      success: false,
    })
    expect(ultraClient.post).not.toHaveBeenCalled()
  })
})
