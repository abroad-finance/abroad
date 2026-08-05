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

const dynamicQrResponse = (overrides: Record<string, unknown> = {}) => ({
  amount: '150.00',
  brCode: '00020126580014BR.GOV.BCB.PIX',
  depositId: DEPOSIT_ID,
  endUserId: TRANSACTION_ID,
  expiresAt: '2026-08-04T13:30:00.000Z',
  status: 'PENDING',
  txid: 'ddddddddeeee4fff8aaabbbbbbbbbbbb',
  ...overrides,
})

const depositDetailResponse = (overrides: Record<string, unknown> = {}) => ({
  amount: '150.00',
  currency: 'BRL',
  depositId: DEPOSIT_ID,
  endToEndId: 'E12345678202608041230abcdef01',
  endUserId: TRANSACTION_ID,
  payer: { bankCode: '20018183', name: 'Joana Silva', taxId: '123.456.789-01' },
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
      expect(body).toEqual({
        amount: 150,
        endUserId: TRANSACTION_ID,
        txid: 'ddddddddeeee4fff8aaabbbbbbbbbbbb',
      })
      expect(idempotencyKey).toBe(`abroad:pix-deposit:${TRANSACTION_ID}`)
    })

    // A retried acceptance must never leave the customer holding two payable
    // QRs for one transaction.
    it('derives the same txid and idempotency key on a retry', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(dynamicQrResponse())
      const service = buildService(client)
      const params = { amount: 150, reference: TRANSACTION_ID, transactionId: TRANSACTION_ID }

      await service.createDeposit(params)
      await service.createDeposit(params)

      expect(client.post.mock.calls[0]).toEqual(client.post.mock.calls[1])
    })

    it('keeps the generated txid inside the 26-35 character dynamic QR range', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(dynamicQrResponse())

      await buildService(client).createDeposit({
        amount: 150,
        reference: 'short-ref',
        transactionId: 'short-id',
      })

      const body = client.post.mock.calls[0][1] as { txid: string }
      expect(body.txid.length).toBeGreaterThanOrEqual(26)
      expect(body.txid.length).toBeLessThanOrEqual(35)
    })

    it('accepts the emvPayload spelling of the BR Code', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(
        dynamicQrResponse({ brCode: undefined, emvPayload: '00020126PAYLOAD' }),
      )

      const result = await buildService(client).createDeposit({
        amount: 150,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual(expect.objectContaining({ brCode: '00020126PAYLOAD', success: true }))
    })

    // Without a payable code there is nothing to show the customer, so this is
    // a hard failure rather than a half-created transaction.
    it('fails permanently when the provider returns no payable code', async () => {
      const client = createUltraClient()
      client.post.mockResolvedValue(
        dynamicQrResponse({ brCode: undefined, emvPayload: undefined }),
      )

      const result = await buildService(client).createDeposit({
        amount: 150,
        reference: TRANSACTION_ID,
        transactionId: TRANSACTION_ID,
      })

      expect(result).toEqual({
        code: 'permanent',
        reason: 'transfero_ultra_deposit_missing_brcode',
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
      client.post.mockResolvedValue({ depositId: DEPOSIT_ID })

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
