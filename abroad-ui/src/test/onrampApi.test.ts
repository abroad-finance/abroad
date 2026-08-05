import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { acceptOnrampTransaction, requestOnrampQuote } from '../features/swap/services/onrampApi'
import { httpClient } from '../services/http/httpClient'

const mockRequest = (result: unknown) =>
  vi.spyOn(httpClient, 'request').mockResolvedValue(result as never)

const quoteResponse = {
  data: {
    expiration_time: 1_800_000_000_000,
    fee: { amount: '0.914', currency: 'USDC', type: 'combined' },
    quote_id: 'quote-1',
    value: 91.482,
  },
  headers: new Headers(),
  ok: true,
  status: 200,
}

const acceptResponse = (overrides: Record<string, unknown> = {}) => ({
  data: {
    id: 'txn-1',
    kycRequired: false,
    payment_instructions: { br_code: '00020126BRCODE', expires_at: 1_800_000_000_000 },
    ...overrides,
  },
  headers: new Headers(),
  ok: true,
  status: 200,
})

describe('requestOnrampQuote', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the fiat amount the customer will pay', async () => {
    const request = mockRequest(quoteResponse)

    await requestOnrampQuote({ cryptoCurrency: 'USDC', fiatAmount: 500, network: 'CELO' })

    expect(request).toHaveBeenCalledWith('/quote/onramp', expect.objectContaining({
      body: JSON.stringify({
        crypto_currency: 'USDC',
        fiat_amount: 500,
        network: 'CELO',
        payment_method: 'PIX',
        target_currency: 'BRL',
      }),
      method: 'POST',
    }))
  })

  // The endpoint returns the crypto the customer receives; mapping it onto the
  // fiat leg would misprice the whole screen.
  it('maps the response value onto the crypto leg and the input onto the fiat leg', async () => {
    mockRequest(quoteResponse)

    const result = await requestOnrampQuote({
      cryptoCurrency: 'USDC',
      fiatAmount: 500,
      network: 'CELO',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.sourceAmount).toBe(91.482)
    expect(result.data.sourceCurrency).toBe('USDC')
    expect(result.data.targetAmount).toBe(500)
    expect(result.data.targetCurrency).toBe('BRL')
    expect(result.data.rail).toBe('PIX')
  })

  it('passes a transport failure through untouched', async () => {
    const failure = {
      error: { message: 'offline', type: 'network' },
      headers: null,
      ok: false,
      status: null,
    }
    mockRequest(failure)

    const result = await requestOnrampQuote({
      cryptoCurrency: 'USDC',
      fiatAmount: 500,
      network: 'CELO',
    })

    expect(result).toEqual(failure)
  })

  it('rejects a response that does not carry a usable quote', async () => {
    mockRequest({
      data: { quote_id: 'quote-1' }, headers: new Headers(), ok: true, status: 200,
    })

    const result = await requestOnrampQuote({
      cryptoCurrency: 'USDC',
      fiatAmount: 500,
      network: 'CELO',
    })

    expect(result.ok).toBe(false)
  })
})

describe('acceptOnrampTransaction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const params = {
    destinationAddress: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    quoteId: 'quote-1',
    userId: 'user-1',
  }

  // Nothing about the payer is collected, so nothing about the payer may leave
  // the browser.
  it('never sends a tax id', async () => {
    const request = mockRequest(acceptResponse())

    await acceptOnrampTransaction(params)

    const [, config] = request.mock.calls[0]
    expect(String((config as { body: string }).body)).not.toContain('tax_id')
  })

  it('sends the wallet destination rather than an account number', async () => {
    const request = mockRequest(acceptResponse())

    await acceptOnrampTransaction(params)

    const [, config] = request.mock.calls[0]
    const body = JSON.parse(String((config as { body: string }).body)) as Record<string, unknown>
    expect(body.destination_address).toBe(params.destinationAddress)
    expect(body).not.toHaveProperty('account_number')
  })

  it('returns the payable code', async () => {
    mockRequest(acceptResponse())

    const result = await acceptOnrampTransaction(params)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({
      kycRequired: false,
      paymentInstructions: { brCode: '00020126BRCODE', expiresAt: 1_800_000_000_000 },
      transactionId: 'txn-1',
    })
  })

  it('surfaces a KYC requirement without inventing a code', async () => {
    mockRequest(acceptResponse({ id: null, kycRequired: true, payment_instructions: null }))

    const result = await acceptOnrampTransaction(params)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.kycRequired).toBe(true)
    expect(result.data.paymentInstructions).toBeNull()
  })

  // Showing a purchase the customer cannot fund is worse than a retryable
  // error, so a success without a code is treated as a failure.
  it('fails when the transaction was accepted without a payable code', async () => {
    mockRequest(acceptResponse({ payment_instructions: null }))

    const result = await acceptOnrampTransaction(params)

    expect(result.ok).toBe(false)
  })

  it('accepts a code that carries no expiry', async () => {
    mockRequest(acceptResponse({
      payment_instructions: { br_code: '00020126BRCODE', expires_at: null },
    }))

    const result = await acceptOnrampTransaction(params)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.paymentInstructions?.expiresAt).toBeNull()
  })
})
