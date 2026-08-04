import { describe, expect, it } from 'vitest'

import type { ApiFailure } from '../services/http/types'

import {
  classifyQuoteFailure,
  isQuoteExpired,
  type QuoteFailureCode,
  quoteFeeSchema,
} from '../features/swap/model/quote'
import { quoteResponseSchema } from '../services/public/types'

const failure = (params: {
  code?: string
  reason?: string
  status?: null | number
  type?: 'aborted' | 'http' | 'network' | 'parse'
}): ApiFailure<unknown> => {
  const status = params.status ?? null
  return {
    error: {
      body: params.reason || params.code ? { code: params.code, reason: params.reason } : null,
      message: 'Bounded request failure',
      status,
      type: params.type ?? 'http',
    },
    headers: null,
    ok: false,
    status,
  }
}

describe('quote failure classification', () => {
  const cases: Array<{ code: QuoteFailureCode, input: Parameters<typeof failure>[0] }> = [
    { code: 'minimum', input: { reason: 'The minimum allowed amount is 10', status: 400 } },
    { code: 'maximum', input: { reason: 'The maximum allowed amount is 500', status: 400 } },
    { code: 'malformed-amount', input: { reason: 'Amount must be a finite number', status: 400 } },
    { code: 'invalid-recipient', input: { reason: 'Invalid PIX key', status: 400 } },
    { code: 'corridor-unavailable', input: { reason: 'Payment method PIX is currently unavailable', status: 400 } },
    { code: 'liquidity-unavailable', input: { reason: 'Unable to verify available liquidity', status: 400 } },
    { code: 'rate-expired', input: { reason: 'Quote expired', status: 400 } },
    { code: 'rate-limited', input: { status: 429 } },
    { code: 'network', input: { type: 'network' } },
    { code: 'policy', input: { reason: 'Request not permitted', status: 403 } },
    { code: 'server', input: { status: 503 } },
    { code: 'timeout', input: { reason: 'Request timed out', status: 400 } },
    { code: 'aborted', input: { type: 'aborted' } },
    { code: 'unknown', input: {} },
  ]

  cases.forEach(({ code, input }) => {
    it(`classifies ${code} without exposing provider copy`, () => {
      expect(classifyQuoteFailure(failure(input)).code).toBe(code)
    })
  })

  it('prefers the stable server code over mutable or localized reason text', () => {
    expect(classifyQuoteFailure(failure({
      code: 'minimum',
      reason: 'This wording may change',
      status: 400,
    }))).toEqual({ action: 'change-amount', code: 'minimum' })
    expect(classifyQuoteFailure(failure({
      code: 'corridor_unavailable',
      reason: 'Internal provider detail that must not drive the UI',
      status: 400,
    }))).toEqual({ action: 'choose-destination', code: 'corridor-unavailable' })
  })

  it('uses the authoritative quote expiry', () => {
    const quote = {
      corridorKey: 'USDC:STELLAR:BRL',
      expiresAt: 2_000,
      fee: null,
      id: 'quote-id',
      network: 'STELLAR',
      rail: 'PIX' as const,
      sourceAmount: 2,
      sourceCurrency: 'USDC' as const,
      targetAmount: 10,
      targetCurrency: 'BRL' as const,
    }

    expect(isQuoteExpired(quote, 1_999)).toBe(false)
    expect(isQuoteExpired(quote, 2_000)).toBe(true)
  })

  it('accepts only exact bounded source-fee snapshots', () => {
    expect(quoteFeeSchema.parse({
      amount: '1.234567',
      currency: 'USDC',
      type: 'combined',
    })).toEqual({
      amount: '1.234567',
      currency: 'USDC',
      type: 'combined',
    })
    expect(quoteFeeSchema.safeParse({
      amount: 1.23,
      currency: 'USDC',
      type: 'combined',
    }).success).toBe(false)
    expect(quoteFeeSchema.safeParse({
      amount: '1.23',
      currency: 'BRL',
      type: 'fixed',
    }).success).toBe(false)
  })

  it('validates the additive quote fee and tolerates a mixed-rollout response without it', () => {
    const response = {
      expiration_time: 2_000,
      fee: { amount: '0', currency: 'USDT', type: 'none' },
      quote_id: 'quote-id',
      value: 10,
    }

    expect(quoteResponseSchema.safeParse(response).success).toBe(true)
    expect(quoteResponseSchema.safeParse({ ...response, fee: undefined }).success).toBe(true)
    expect(quoteResponseSchema.safeParse({
      ...response,
      fee: { amount: '0.0000001', currency: 'USDT', type: 'none' },
    }).success).toBe(false)
  })
})
