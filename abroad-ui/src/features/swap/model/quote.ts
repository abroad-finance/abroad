import { z } from 'zod'

import type { ApiFailure } from '../../../services/http/types'

export type QuoteFailureCode
  = | 'aborted'
    | 'corridor-unavailable'
    | 'invalid-recipient'
    | 'liquidity-unavailable'
    | 'malformed-amount'
    | 'maximum'
    | 'minimum'
    | 'network'
    | 'policy'
    | 'rate-expired'
    | 'rate-limited'
    | 'server'
    | 'timeout'
    | 'unknown'

export type QuoteIssue = {
  action: QuoteIssueAction
  code: QuoteFailureCode
}

export type QuoteIssueAction = 'change-amount' | 'change-recipient' | 'choose-destination' | 'retry' | 'wait-and-retry'

export const quoteFeeSchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
  currency: z.enum(['USDC', 'USDT']),
  type: z.enum([
    'combined',
    'fixed',
    'none',
    'percentage',
  ]),
}).strict()

export const quoteSnapshotSchema = z.object({
  corridorKey: z.string().min(1).max(256),
  expiresAt: z.number().int().positive(),
  fee: quoteFeeSchema.nullable(),
  id: z.string().min(1).max(128),
  network: z.string().min(1).max(64),
  rail: z.enum(['BREB', 'PIX']),
  sourceAmount: z.number().finite().positive(),
  sourceCurrency: z.enum(['USDC', 'USDT']),
  targetAmount: z.number().finite().positive(),
  targetCurrency: z.enum(['BRL', 'COP']),
}).strict()

export type QuoteFee = z.infer<typeof quoteFeeSchema>
export type QuoteSnapshot = z.infer<typeof quoteSnapshotSchema>

const normalizedReason = (failure: ApiFailure<unknown>): string => {
  const body = failure.error.body
  if (typeof body !== 'object' || body === null) return ''
  const reason = Reflect.get(body, 'reason')
  return typeof reason === 'string' ? reason.trim().toLowerCase().slice(0, 500) : ''
}

const normalizedCode = (failure: ApiFailure<unknown>): string => {
  const body = failure.error.body
  if (typeof body !== 'object' || body === null) return ''
  const code = Reflect.get(body, 'code')
  return typeof code === 'string' ? code.trim().toLowerCase().slice(0, 64) : ''
}

const includesOneOf = (value: string, candidates: readonly string[]): boolean => (
  candidates.some(candidate => value.includes(candidate))
)

export const classifyQuoteFailure = (failure: ApiFailure<unknown>): QuoteIssue => {
  if (failure.error.type === 'aborted') return { action: 'retry', code: 'aborted' }
  if (failure.error.type === 'network') return { action: 'retry', code: 'network' }
  if (failure.error.type === 'parse') return { action: 'retry', code: 'server' }

  const code = normalizedCode(failure)
  switch (code) {
    case 'authentication_failed':
    case 'invalid_request':
    case 'policy':
      return { action: 'retry', code: 'policy' }
    case 'corridor_unavailable':
      return { action: 'choose-destination', code: 'corridor-unavailable' }
    case 'invalid_recipient':
      return { action: 'change-recipient', code: 'invalid-recipient' }
    case 'liquidity_unavailable':
      return { action: 'wait-and-retry', code: 'liquidity-unavailable' }
    case 'malformed_amount':
      return { action: 'change-amount', code: 'malformed-amount' }
    case 'maximum':
      return { action: 'change-amount', code: 'maximum' }
    case 'minimum':
      return { action: 'change-amount', code: 'minimum' }
    case 'quote_unavailable':
    case 'server_error':
      return { action: 'retry', code: 'server' }
    case 'rate_expired':
      return { action: 'retry', code: 'rate-expired' }
    case 'rate_limited':
      return { action: 'wait-and-retry', code: 'rate-limited' }
  }

  const reason = normalizedReason(failure)
  const status = failure.status ?? failure.error.status

  if (status === 429) return { action: 'wait-and-retry', code: 'rate-limited' }
  if (typeof status === 'number' && status >= 500) return { action: 'retry', code: 'server' }
  if (includesOneOf(reason, ['timed out', 'timeout'])) return { action: 'retry', code: 'timeout' }
  if (includesOneOf(reason, ['minimum', 'below min'])) return { action: 'change-amount', code: 'minimum' }
  if (includesOneOf(reason, ['maximum', 'above max'])) return { action: 'change-amount', code: 'maximum' }
  if (includesOneOf(reason, [
    'invalid amount',
    'amount must',
    'expected number',
    'finite number',
  ])) {
    return { action: 'change-amount', code: 'malformed-amount' }
  }
  if (includesOneOf(reason, [
    'recipient',
    'pix key',
    'account number',
    'bre-b key',
    'breb key',
  ])) {
    return { action: 'change-recipient', code: 'invalid-recipient' }
  }
  if (includesOneOf(reason, [
    'liquidity',
    'insufficient balance',
    'balance unavailable',
  ])) {
    return { action: 'wait-and-retry', code: 'liquidity-unavailable' }
  }
  if (includesOneOf(reason, [
    'expired',
    'stale quote',
    'rate changed',
  ])) {
    return { action: 'retry', code: 'rate-expired' }
  }
  if (includesOneOf(reason, [
    'corridor',
    'payment method',
    'currently unavailable',
    'not enabled',
  ])) {
    return { action: 'choose-destination', code: 'corridor-unavailable' }
  }
  if (typeof status === 'number' && status >= 400 && status < 500) return { action: 'retry', code: 'policy' }
  return { action: 'retry', code: 'unknown' }
}

export const isQuoteExpired = (quote: QuoteSnapshot, now: number = Date.now()): boolean => (
  quote.expiresAt <= now
)
