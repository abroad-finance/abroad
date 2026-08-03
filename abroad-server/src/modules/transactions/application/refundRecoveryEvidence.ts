import type { Prisma, TransactionStatus } from '@prisma/client'

import { z } from 'zod'

const STELLAR_HASH_PATTERN = /^[0-9a-f]{64}$/i
const ORIGINAL_REFUND_FINALITY_MS = 2 * 60_000

const refundContextSchema = z.object({
  attempts: z.number().int().nonnegative().optional(),
  candidateTransactionId: z.string().optional(),
  lastError: z.string().optional(),
  reason: z.string().optional(),
  refundTransactionId: z.string().optional(),
  status: z.enum(['failed', 'pending', 'succeeded']).optional(),
  trigger: z.string().optional(),
}).passthrough()

const horizonFailureSchema = z.object({
  extras: z.object({
    hash: z.string(),
  }).passthrough(),
}).passthrough()

export type RefundTransitionEvidence = {
  attempts: number
  candidateHash: null | string
  failureCategory: RefundFailureCategory
  idempotencyKey: string
  originalHashExpiresAt: Date
  reason: null | string
  status: 'failed' | 'pending' | 'succeeded'
  trigger: null | string
}

type RefundFailureCategory = 'NETWORK_TIMEOUT' | 'PROVIDER_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'RATE_LIMIT' | 'UNKNOWN'

type TransitionEvidenceInput = {
  context: null | Prisma.JsonValue
  createdAt: Date
  event: string
  idempotencyKey: string
}

const isStellarTransactionHash = (value: string | undefined): value is string => (
  typeof value === 'string' && STELLAR_HASH_PATTERN.test(value)
)

const parseHashFromFailure = (lastError: string | undefined): null | string => {
  if (!lastError) return null
  try {
    const parsed: unknown = JSON.parse(lastError)
    const result = horizonFailureSchema.safeParse(parsed)
    return result.success && isStellarTransactionHash(result.data.extras.hash)
      ? result.data.extras.hash.toLowerCase()
      : null
  }
  catch {
    return null
  }
}

const classifyFailure = (lastError: string | undefined): RefundFailureCategory => {
  if (!lastError) return 'UNKNOWN'
  if (/429|rate.?limit/i.test(lastError)) return 'RATE_LIMIT'
  if (/408|504|timeout|timed out/i.test(lastError)) return 'NETWORK_TIMEOUT'
  if (/500|502|503|provider.unavailable/i.test(lastError)) return 'PROVIDER_UNAVAILABLE'
  if (/400|rejected|failed|invalid/i.test(lastError)) return 'PROVIDER_REJECTED'
  return 'UNKNOWN'
}

export const parseRefundTransition = (
  transition: TransitionEvidenceInput | undefined,
): null | RefundTransitionEvidence => {
  if (!transition || transition.event !== 'refund') return null
  const parsed = refundContextSchema.safeParse(transition.context)
  if (!parsed.success) return null
  const context = parsed.data
  const directCandidate = isStellarTransactionHash(context.candidateTransactionId)
    ? context.candidateTransactionId.toLowerCase()
    : isStellarTransactionHash(context.refundTransactionId)
      ? context.refundTransactionId.toLowerCase()
      : null

  return {
    attempts: context.attempts ?? 0,
    candidateHash: directCandidate ?? parseHashFromFailure(context.lastError),
    failureCategory: classifyFailure(context.lastError),
    idempotencyKey: transition.idempotencyKey,
    originalHashExpiresAt: new Date(transition.createdAt.getTime() + ORIGINAL_REFUND_FINALITY_MS),
    reason: context.reason?.trim() || null,
    status: context.status ?? 'pending',
    trigger: context.trigger?.trim() || null,
  }
}

const wrongAmountSchema = z.object({
  receivedAmount: z.number().positive(),
}).passthrough()

export const resolveRefundAmount = (params: {
  quoteSourceAmount: number
  refundEvidence: null | RefundTransitionEvidence
  status: TransactionStatus
  transitions: readonly TransitionEvidenceInput[]
}): null | number => {
  if (params.refundEvidence?.reason === 'wrong_amount') {
    for (const transition of params.transitions) {
      if (transition.event !== 'wrong_amount') continue
      const parsed = wrongAmountSchema.safeParse(transition.context)
      if (parsed.success) return parsed.data.receivedAmount
    }
    return null
  }

  if (params.refundEvidence?.reason === 'expired_transaction') {
    // Expired deposits can arrive with an amount different from the quote. The
    // original queue payload is not durably stored, so guessing is unsafe.
    return null
  }

  if (params.refundEvidence?.reason === 'provider_failed' || params.status === 'PAYMENT_FAILED') {
    return Number.isFinite(params.quoteSourceAmount) && params.quoteSourceAmount > 0
      ? params.quoteSourceAmount
      : null
  }

  return null
}

export const refundHashFingerprint = (transactionId: null | string): null | string => (
  transactionId ? `••••${transactionId.slice(-8)}` : null
)
