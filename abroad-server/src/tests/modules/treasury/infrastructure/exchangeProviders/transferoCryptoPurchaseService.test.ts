import 'reflect-metadata'
import { CryptoCurrency } from '@prisma/client'

import { TransferoUltraClient, TransferoUltraError } from '../../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { TransferoCryptoPurchaseService } from '../../../../../modules/treasury/infrastructure/exchangeProviders/transferoCryptoPurchaseService'
import { createMockLogger } from '../../../../setup/mockFactories'

type UltraClientMock = jest.Mocked<Pick<TransferoUltraClient, 'get' | 'patch' | 'post'>>

const createUltraClient = (): UltraClientMock => ({
  get: jest.fn(),
  patch: jest.fn(),
  post: jest.fn(),
})

const buildService = (client: UltraClientMock) => new TransferoCryptoPurchaseService(
  client as unknown as TransferoUltraClient,
  createMockLogger(),
)

const withdrawalResponse = (overrides: Record<string, unknown> = {}) => ({
  amount: '1',
  asset: 'USDC',
  blockchain: 'POLYGON',
  status: 'PENDING_APPROVAL',
  toAddress: '0xtreasury',
  transactionId: 'wd-1',
  ...overrides,
})

const withdrawalParams = {
  address: '0x829aeCA64708c33300F78aA61104940f380628A8',
  amount: 18.2,
  asset: CryptoCurrency.USDC,
  network: 'POLYGON',
  operationId: 'replenish:batch-1',
}

describe('TransferoCryptoPurchaseService.withdrawToTreasury', () => {
  // The exact wire shape, pinned against the API's own validation errors:
  // `amount` is a decimal STRING, the destination field is
  // `destinationAddress` (not `toAddress`), and this endpoint requires
  // `idempotencyKey` in the BODY as well as the header. Sending a number or
  // `toAddress` returns 400 and no withdrawal is created.
  it('sends the shape the endpoint actually accepts', async () => {
    const client = createUltraClient()
    client.post.mockResolvedValue(withdrawalResponse())

    await buildService(client).withdrawToTreasury(withdrawalParams)

    const [path, body, idempotencyKey] = client.post.mock.calls[0]
    expect(path).toBe('/api/v1/vault/withdrawals')
    expect(body).toEqual({
      amount: '18.2',
      asset: 'USDC',
      blockchain: 'POLYGON',
      destinationAddress: withdrawalParams.address,
      idempotencyKey: 'abroad:treasury-withdrawal:replenish:batch-1',
    })
    // Body token and transport header must agree, or a retry dedupes against
    // a different key than the one the banking layer recorded.
    expect(idempotencyKey).toBe('abroad:treasury-withdrawal:replenish:batch-1')
  })

  it('never sends a numeric amount', async () => {
    const client = createUltraClient()
    client.post.mockResolvedValue(withdrawalResponse())

    await buildService(client).withdrawToTreasury(withdrawalParams)

    const body = client.post.mock.calls[0][1] as { amount: unknown }
    expect(typeof body.amount).toBe('string')
  })

  it('derives the same idempotency key on a retry so it cannot double-withdraw', async () => {
    const client = createUltraClient()
    client.post.mockResolvedValue(withdrawalResponse())
    const service = buildService(client)

    await service.withdrawToTreasury(withdrawalParams)
    await service.withdrawToTreasury(withdrawalParams)

    expect(client.post.mock.calls[0]).toEqual(client.post.mock.calls[1])
  })

  it('returns the provider withdrawal id on acceptance', async () => {
    const client = createUltraClient()
    client.post.mockResolvedValue(withdrawalResponse())

    const result = await buildService(client).withdrawToTreasury(withdrawalParams)

    expect(result).toEqual({ success: true, withdrawalId: 'wd-1' })
  })

  // Over the auto-approval cap a withdrawal sits at the desk. That is a normal
  // outcome, not a failure — the id is what reconciliation needs.
  it('treats a desk-held withdrawal as accepted', async () => {
    const client = createUltraClient()
    client.post.mockResolvedValue(withdrawalResponse({ status: 'PENDING_APPROVAL' }))

    const result = await buildService(client).withdrawToTreasury(withdrawalParams)

    expect(result).toEqual({ success: true, withdrawalId: 'wd-1' })
  })

  it.each(['FAILED', 'CANCELLED'])('reports a %s withdrawal as permanently failed', async (status) => {
    const client = createUltraClient()
    client.post.mockResolvedValue(withdrawalResponse({ status }))

    const result = await buildService(client).withdrawToTreasury(withdrawalParams)

    expect(result).toEqual({
      code: 'permanent',
      reason: `transfero_ultra_withdrawal_${status.toLowerCase()}`,
      success: false,
    })
  })

  it.each([0, -1, Number.NaN])('rejects a %p amount before calling the provider', async (amount) => {
    const client = createUltraClient()

    const result = await buildService(client).withdrawToTreasury({ ...withdrawalParams, amount })

    expect(result).toEqual({
      code: 'validation',
      reason: 'invalid_withdrawal_amount',
      success: false,
    })
    expect(client.post).not.toHaveBeenCalled()
  })

  it('surfaces a provider failure with its own retriability', async () => {
    const client = createUltraClient()
    client.post.mockRejectedValue(
      new TransferoUltraError({ code: 'retriable', message: 'desk_unavailable' }),
    )

    const result = await buildService(client).withdrawToTreasury(withdrawalParams)

    expect(result).toEqual({ code: 'retriable', reason: 'desk_unavailable', success: false })
  })

  // A rejected request shape must not look retriable, or the worker spins.
  it('treats a malformed response as permanent', async () => {
    const client = createUltraClient()
    client.post.mockResolvedValue({ nope: true })

    const result = await buildService(client).withdrawToTreasury(withdrawalParams)

    expect(result).toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_withdrawal_schema_mismatch',
      success: false,
    })
  })
})

describe('TransferoCryptoPurchaseService.buyWithBrl', () => {
  const buyParams = {
    asset: CryptoCurrency.USDC,
    brlAmount: 350,
    operationId: 'replenish:batch-1',
  }

  it.each([0, -1, Number.NaN])('rejects a %p BRL amount before calling the desk', async (brlAmount) => {
    const client = createUltraClient()

    const result = await buildService(client).buyWithBrl({ ...buyParams, brlAmount })

    expect(result).toEqual({ code: 'validation', reason: 'invalid_brl_amount', success: false })
    expect(client.post).not.toHaveBeenCalled()
  })

  it('opens a D0 BUY session for the requested asset', async () => {
    const client = createUltraClient()
    client.post.mockRejectedValue(
      new TransferoUltraError({ code: 'retriable', message: 'desk_closed' }),
    )

    await buildService(client).buyWithBrl(buyParams)

    const [path, body] = client.post.mock.calls[0]
    expect(path).toBe('/api/v1/otc/sessions')
    expect(body).toEqual(expect.objectContaining({
      amount: 350,
      currency: 'USDC',
      settlement: 'D0',
      side: 'BUY',
    }))
  })

  // Settling a side or tenor we did not request would book an obligation the
  // caller never sized.
  it('refuses a session the desk priced on a different side', async () => {
    const client = createUltraClient()
    client.post.mockResolvedValue({
      amount: 350,
      client_name: 'Abroad',
      created_at: '2026-08-05T12:00:00.000Z',
      currency: 'USDC',
      expires_at: '2026-08-05T12:00:07.000Z',
      price: 6.15,
      session_id: 'sess-1',
      settlement: 'D0',
      side: 'SELL',
      spot: 6.15,
      status: 'OPEN',
      total_brl: 350,
    })

    const result = await buildService(client).buyWithBrl(buyParams)

    expect(result).toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_buy_session_mismatch',
      success: false,
    })
    // Never confirmed into a trade.
    expect(client.patch).not.toHaveBeenCalled()
  })
})
