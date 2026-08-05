import 'reflect-metadata'

import { TransferoPixDepositService } from '../../../../../modules/payments/infrastructure/paymentProviders/transferoPixDepositService'
import { TransferoUltraClient, TransferoUltraError } from '../../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { createMockLogger } from '../../../../setup/mockFactories'

type UltraClientMock = jest.Mocked<
  Pick<TransferoUltraClient, 'get' | 'patch' | 'post'>
>

const TRANSACTION_ID = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb'
const DEPOSIT_ID = 'dep-9001'

const createUltraClient = (): UltraClientMock => ({
  get: jest.fn(),
  patch: jest.fn(),
  post: jest.fn(),
})

const buildService = (client: UltraClientMock) => new TransferoPixDepositService(
  client as unknown as TransferoUltraClient,
  createMockLogger(),
)

// Mirrors the live 201 from POST /api/v1/pix/qr-codes/dynamic: the deposit id
// is `id` and the payable EMV payload is `qrCode`. There is no `depositId`,
// `brCode`, `emvPayload` or `txid` anywhere in this exchange.
const dynamicQrResponse = (overrides: Record<string, unknown> = {}) => ({
  amount: 150,
  blockchainFee: '0.00',
  endUserId: TRANSACTION_ID,
  expiresAt: '2026-08-04T13:30:00.000Z',
  id: DEPOSIT_ID,
  qrCode: '00020126580014BR.GOV.BCB.PIX',
  qrCodeBase64: 'https://brcode.starkinfra.com/dynamic-qrcode/abc.png',
  status: 'PENDING',
  ...overrides,
})

// Mirrors the live 200 from GET /api/v1/pix/deposits/:id, which also keys the
// deposit as `id` and names the expiry `qrCodeExpiresAt`.
const depositDetailResponse = (overrides: Record<string, unknown> = {}) => ({
  amount: '150.00',
  currency: 'BRL',
  endToEndId: 'E12345678202608041230abcdef01',
  endUserId: TRANSACTION_ID,
  id: DEPOSIT_ID,
  payer: { bankCode: '20018183', name: 'Joana Silva', taxId: '123.456.789-01' },
  qrCodeExpiresAt: '2026-08-04T13:30:00.000Z',
  qrCodeType: 'DYNAMIC',
  status: 'COMPLETED',
  ...overrides,
})

describe('TransferoPixDepositService', () => {
  describe('createDeposit', () => {
    it('issues a dynamic QR carrying the transaction reference and returns its BR Code', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(dynamicQrResponse())

      const result = await buildService(client).createDeposit({
        amount: 150,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual({
        brCode: '00020126580014BR.GOV.BCB.PIX',
        expiresAt: new Date('2026-08-04T13:30:00.000Z'),
        providerDepositId: DEPOSIT_ID,
        success: true,
      })
      const [path, body, idempotencyKey] = client.post.mock.calls[0]
      expect(path).toBe('/api/v1/pix/qr-codes/dynamic')
      // The endpoint's schema is strict: it accepts exactly these two keys.
      expect(body).toEqual({
        amount: 150,
        endUserId: TRANSACTION_ID,
      })
      expect(idempotencyKey).toBe(`abroad:pix-deposit:${TRANSACTION_ID}`)
    })

    // Sending a txid is rejected outright with
    // `body/ Unrecognized key: "txid"`, which took the whole onramp down: every
    // acceptance failed at code generation. The txid the PIX spec describes is
    // minted by Ultra, not supplied by us.
    it('never sends a txid', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(dynamicQrResponse())

      await buildService(client).createDeposit({
        amount: 150,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(client.post.mock.calls[0][1]).not.toHaveProperty('txid')
    })

    // The endpoint rejects a string amount with
    // `body/amount Invalid input: expected number, received string`.
    it('sends the amount as a number', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(dynamicQrResponse())

      await buildService(client).createDeposit({
        amount: 150,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      const body = client.post.mock.calls[0][1] as { amount: unknown }
      expect(typeof body.amount).toBe('number')
    })

    // A retried acceptance must never leave the customer holding two payable
    // QRs for one transaction.
    it('derives the same idempotency key on a retry', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(dynamicQrResponse())
      const service = buildService(client)
      const params = { amount: 150, reference: TRANSACTION_ID, transactionId: TRANSACTION_ID }

      await service.createDeposit(params)
      await service.createDeposit(params)

      expect(client.post.mock.calls[0]).toEqual(client.post.mock.calls[1])
    })

    // Without a payable code there is nothing to show the customer, so this is
    // a hard failure rather than a half-created transaction.
    it('fails permanently when the provider returns no payable code', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(dynamicQrResponse({ qrCode: undefined }))

      const result = await buildService(client).createDeposit({
        amount: 150,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual({
        code: 'permanent',
        reason: 'transfero_ultra_deposit_create_schema_mismatch',
        success: false,
      })
    })

    it.each([0, -1, Number.NaN])('rejects a %p amount before calling the provider', async (amount) => {
      const client = createUltraClient()

      const result = await buildService(client).createDeposit({
        amount,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual({
        code: 'validation',
        reason: 'transfero_ultra_deposit_amount_invalid',
        success: false,
      })
      expect(client.post).not.toHaveBeenCalled()
    })

    it('surfaces a provider failure with its own retriability', async () => {
      const client = createUltraClient()
      client.post.mockRejectedValue(
        new TransferoUltraError({ code: 'retriable', message: 'rate_limited' }),
      )

      const result = await buildService(client).createDeposit({
        amount: 150,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual({ code: 'retriable', reason: 'rate_limited', success: false })
    })

    it('treats a malformed provider response as permanent rather than retrying it', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue({ id: DEPOSIT_ID })

      const result = await buildService(client).createDeposit({
        amount: 150,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual({
        code: 'permanent',
        reason: 'transfero_ultra_deposit_create_schema_mismatch',
        success: false,
      })
    })
  })

  describe('getDepositFacts', () => {
    it('reads the credited amount and normalizes the payer tax id', async () => {
      const client = createUltraClient()
      client.get.mockResolvedValue(depositDetailResponse())

      const result = await buildService(client).getDepositFacts(DEPOSIT_ID)

      expect(result).toEqual({
        facts: {
          amount: 150,
          endToEndId: 'E12345678202608041230abcdef01',
          payerTaxId: '12345678901',
          providerDepositId: DEPOSIT_ID,
          status: 'COMPLETED',
        },
        success: true,
      })
      expect(client.get).toHaveBeenCalledWith(`/api/v1/pix/deposits/${DEPOSIT_ID}`)
    })

    // PENDING and PROCESSING both mean "not spendable yet"; only COMPLETED
    // releases a delivery.
    it.each([
      ['PENDING', 'AWAITING_PAYMENT'],
      ['PROCESSING', 'PAID'],
      ['PAID', 'PAID'],
      ['COMPLETED', 'COMPLETED'],
      ['EXPIRED', 'EXPIRED'],
      ['REFUNDED', 'REFUNDED'],
      ['FAILED', 'FAILED'],
    ])('maps provider status %s to %s', async (providerStatus, expected) => {
      const client = createUltraClient()
      client.get.mockResolvedValue(depositDetailResponse({ status: providerStatus }))

      const result = await buildService(client).getDepositFacts(DEPOSIT_ID)

      expect(result).toEqual(
        expect.objectContaining({
          facts: expect.objectContaining({ status: expected }),
          success: true,
        }),
      )
    })

    it('reports a missing payer tax id as null instead of an empty string', async () => {
      const client = createUltraClient()
      client.get.mockResolvedValue(
        depositDetailResponse({ payer: { bankCode: null, name: null, taxId: null } }),
      )

      const result = await buildService(client).getDepositFacts(DEPOSIT_ID)

      expect(result).toEqual(
        expect.objectContaining({
          facts: expect.objectContaining({ payerTaxId: null }),
        }),
      )
    })

    it('refuses to interpret a status it does not know', async () => {
      const client = createUltraClient()
      client.get.mockResolvedValue(depositDetailResponse({ status: 'SOMETHING_NEW' }))

      const result = await buildService(client).getDepositFacts(DEPOSIT_ID)

      expect(result).toEqual({
        code: 'permanent',
        reason: 'transfero_ultra_deposit_read_schema_mismatch',
        success: false,
      })
    })
  })

  describe('refundDeposit', () => {
    // The provider resolves the payer from the deposit; no destination is ever
    // accepted from the caller.
    it('refunds by deposit id only and never names a destination', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue({ id: 'refund-1', status: 'PROCESSING' })

      const result = await buildService(client).refundDeposit({
        providerDepositId: DEPOSIT_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual({ providerRefundId: 'refund-1', success: true })
      expect(client.post).toHaveBeenCalledWith(
        '/api/v1/pix/refunds',
        { depositId: DEPOSIT_ID },
        `abroad:pix-refund:${TRANSACTION_ID}`,
      )
    })

    it('surfaces a refund failure without claiming success', async () => {
      const client = createUltraClient()
      client.post.mockRejectedValue(
        new TransferoUltraError({ code: 'permanent', message: 'RECEIPT_NOT_AVAILABLE' }),
      )

      const result = await buildService(client).refundDeposit({
        providerDepositId: DEPOSIT_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual({
        code: 'permanent',
        reason: 'RECEIPT_NOT_AVAILABLE',
        success: false,
      })
    })
  })
})
