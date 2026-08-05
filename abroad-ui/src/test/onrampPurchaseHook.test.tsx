import { act, renderHook, waitFor } from '@testing-library/react'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { useOnrampPurchase } from '../features/swap/hooks/useOnrampPurchase'
import { httpClient } from '../services/http/httpClient'

const params = {
  cryptoCurrency: 'USDC' as const,
  destinationAddress: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  fiatAmount: 500,
  network: 'CELO',
  userId: 'user-1',
}

const okQuote = {
  data: { expiration_time: 1_800_000_000_000, quote_id: 'quote-1', value: 91.482 },
  headers: new Headers(),
  ok: true,
  status: 200,
}

const okAccept = (overrides: Record<string, unknown> = {}) => ({
  data: {
    id: 'txn-1',
    kycRequired: false,
    payment_instructions: { br_code: '00020126BRCODE', expires_at: null },
    ...overrides,
  },
  headers: new Headers(),
  ok: true,
  status: 200,
})

const failure = {
  error: { message: 'nope', status: 400, type: 'http' },
  headers: null,
  ok: false,
  status: 400,
}

describe('useOnrampPurchase', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prices then accepts, ending with a payable code', async () => {
    vi.spyOn(httpClient, 'request')
      .mockResolvedValueOnce(okQuote as never)
      .mockResolvedValueOnce(okAccept() as never)
    const { result } = renderHook(() => useOnrampPurchase())

    await act(async () => {
      await result.current.startPurchase(params)
    })

    await waitFor(() => {
      expect(result.current.state.instructions).toEqual({
        brCode: '00020126BRCODE',
        expiresAt: null,
      })
    })
    expect(result.current.state.quote?.sourceAmount).toBe(91.482)
    expect(result.current.state.transactionId).toBe('txn-1')
    expect(result.current.state.issue).toBeNull()
  })

  // A failed quote must not go on to accept anything: there is no priced
  // purchase to accept.
  it('does not accept a transaction when pricing failed', async () => {
    const request = vi.spyOn(httpClient, 'request').mockResolvedValue(failure as never)
    const { result } = renderHook(() => useOnrampPurchase())

    await act(async () => {
      await result.current.startPurchase(params)
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(result.current.state.issue).not.toBeNull()
    expect(result.current.state.instructions).toBeNull()
  })

  it('keeps the quote but reports the issue when acceptance fails', async () => {
    vi.spyOn(httpClient, 'request')
      .mockResolvedValueOnce(okQuote as never)
      .mockResolvedValueOnce(failure as never)
    const { result } = renderHook(() => useOnrampPurchase())

    await act(async () => {
      await result.current.startPurchase(params)
    })

    expect(result.current.state.quote?.id).toBe('quote-1')
    expect(result.current.state.issue).not.toBeNull()
    expect(result.current.state.instructions).toBeNull()
  })

  it('surfaces a KYC requirement with no code attached', async () => {
    vi.spyOn(httpClient, 'request')
      .mockResolvedValueOnce(okQuote as never)
      .mockResolvedValueOnce(okAccept({ id: null, kycRequired: true, payment_instructions: null }) as never)
    const { result } = renderHook(() => useOnrampPurchase())

    await act(async () => {
      await result.current.startPurchase(params)
    })

    expect(result.current.state.kycRequired).toBe(true)
    expect(result.current.state.instructions).toBeNull()
  })

  it('clears everything on reset so a new purchase starts clean', async () => {
    vi.spyOn(httpClient, 'request')
      .mockResolvedValueOnce(okQuote as never)
      .mockResolvedValueOnce(okAccept() as never)
    const { result } = renderHook(() => useOnrampPurchase())

    await act(async () => {
      await result.current.startPurchase(params)
    })
    act(() => {
      result.current.reset()
    })

    expect(result.current.state).toEqual({
      instructions: null,
      isSubmitting: false,
      issue: null,
      kycRequired: false,
      quote: null,
      transactionId: null,
    })
  })
})
