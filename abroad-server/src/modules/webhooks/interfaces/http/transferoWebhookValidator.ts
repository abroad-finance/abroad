import { TargetCurrency } from '@prisma/client'
import { z } from 'zod'

import { PaymentStatusUpdatedMessage } from '../../../../platform/messaging/queueSchema'
import { transferoUltraDecimalSchema, transferoUltraWithdrawalStatusSchema } from '../../../transfero/infrastructure/transferoUltraSchemas'

const transferoUltraWebhookEnvelopeSchema = z.object({
  attempt: z.number().int().positive(),
  data: z.unknown(),
  deliveredAt: z.string().min(1),
  endClientId: z.string().min(1).optional(),
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  occurredAt: z.string().min(1),
  partnerId: z.string().min(1),
}).loose()

const transferoUltraPixWithdrawalDataSchema = z.object({
  amount: transferoUltraDecimalSchema,
  createdAt: z.string().min(1),
  currency: z.literal('BRL'),
  endToEndId: z.string().nullable(),
  failureReason: z.string().nullable(),
  pixKey: z.string().min(1),
  pixKeyType: z.enum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP', 'BRCODE']),
  pspTransactionId: z.string().nullable(),
  returnedAt: z.string().nullable(),
  settledAt: z.string().nullable(),
  status: transferoUltraWithdrawalStatusSchema,
  tags: z.array(z.string()),
  withdrawalId: z.string().uuid(),
}).loose()

const transferoUltraCryptoDepositConfirmedDataSchema = z.object({
  amount: transferoUltraDecimalSchema,
  asset: z.enum(['USDC', 'USDT']),
  blockchain: z.enum(['POLYGON', 'ETHEREUM']),
  confirmedAt: z.string().min(1),
  fromAddress: z.string().min(1),
  status: z.literal('CONFIRMED'),
  transactionId: z.string().min(1),
  txHash: z.string().min(1),
}).loose()

const transferoUltraCryptoDepositCreditFailedDataSchema = z.object({
  amount: transferoUltraDecimalSchema,
  asset: z.enum(['USDC', 'USDT']),
  blockchain: z.enum(['POLYGON', 'ETHEREUM']),
  failureReason: z.string().min(1),
  transactionId: z.string().min(1),
  txHash: z.string().min(1),
}).loose()

const submittedStatuses = new Set([
  'APPROVED',
  'HELD_FOR_REVIEW',
  'PENDING',
  'PENDING_APPROVAL',
  'PROCESSING',
])
const failedStatuses = new Set([
  'CANCELLED',
  'FAILED',
  'REJECTED',
])
const returnedStatuses = new Set(['RETURNED'])
const settledStatuses = new Set(['SETTLED'])

type TransferoUltraWebhookAction
  = | {
    action: 'credit-failed'
    asset: 'USDC' | 'USDT'
    blockchain: 'ETHEREUM' | 'POLYGON'
    eventId: string
    eventType: string
    failureReason: string
    transactionId: string
  }
  | {
    action: 'exchange-balance-updated'
    eventId: string
    eventType: string
  }
  | {
    action: 'ignored'
    eventId: string
    eventType: string
  }
  | {
    action: 'payment-status-updated'
    eventId: string
    eventType: string
    message: PaymentStatusUpdatedMessage
  }

type TransferoUltraWebhookValidationResult
  = | {
    action: TransferoUltraWebhookAction
    attempt: number
    success: true
  }
  | { errors: string, success: false }

export function parseTransferoWebhook(
  body: Record<string, unknown>,
): TransferoUltraWebhookValidationResult {
  const parsedEnvelope = transferoUltraWebhookEnvelopeSchema.safeParse(body)
  if (!parsedEnvelope.success) {
    return {
      errors: JSON.stringify(parsedEnvelope.error.issues),
      success: false,
    }
  }
  const envelope = parsedEnvelope.data

  switch (envelope.eventType) {
    case 'crypto.deposit.confirmed': {
      const confirmed = transferoUltraCryptoDepositConfirmedDataSchema.safeParse(
        envelope.data,
      )
      if (!confirmed.success) {
        return { errors: JSON.stringify(confirmed.error.issues), success: false }
      }
      return {
        action: {
          action: 'exchange-balance-updated',
          eventId: envelope.eventId,
          eventType: envelope.eventType,
        },
        attempt: envelope.attempt,
        success: true,
      }
    }
    case 'crypto.deposit.credit_failed': {
      const failed = transferoUltraCryptoDepositCreditFailedDataSchema.safeParse(
        envelope.data,
      )
      if (!failed.success) {
        return { errors: JSON.stringify(failed.error.issues), success: false }
      }
      return {
        action: {
          action: 'credit-failed',
          asset: failed.data.asset,
          blockchain: failed.data.blockchain,
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          failureReason: failed.data.failureReason,
          transactionId: failed.data.transactionId,
        },
        attempt: envelope.attempt,
        success: true,
      }
    }
    case 'pix.withdrawal.failed':
      return parsePixWithdrawal(envelope, failedStatuses)
    case 'pix.withdrawal.returned':
      return parsePixWithdrawal(envelope, returnedStatuses)
    case 'pix.withdrawal.settled':
      return parsePixWithdrawal(envelope, settledStatuses)
    case 'pix.withdrawal.submitted':
      return parsePixWithdrawal(envelope)
    default:
      return {
        action: {
          action: 'ignored',
          eventId: envelope.eventId,
          eventType: envelope.eventType,
        },
        attempt: envelope.attempt,
        success: true,
      }
  }
}

function parsePixWithdrawal(
  envelope: z.infer<typeof transferoUltraWebhookEnvelopeSchema>,
  expectedStatuses?: ReadonlySet<string>,
): TransferoUltraWebhookValidationResult {
  const parsed = transferoUltraPixWithdrawalDataSchema.safeParse(envelope.data)
  if (!parsed.success) {
    return { errors: JSON.stringify(parsed.error.issues), success: false }
  }
  if (expectedStatuses && !expectedStatuses.has(parsed.data.status)) {
    return {
      errors: `Webhook event ${envelope.eventType} carried status ${parsed.data.status}`,
      success: false,
    }
  }
  if (!expectedStatuses && !submittedStatuses.has(parsed.data.status)) {
    return {
      errors: `Submitted withdrawal carried terminal status ${parsed.data.status}`,
      success: false,
    }
  }

  const amount = Number(parsed.data.amount)
  if (!Number.isFinite(amount) || amount < 0) {
    return { errors: 'Withdrawal amount is not a finite non-negative number', success: false }
  }

  return {
    action: {
      action: 'payment-status-updated',
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      message: {
        amount,
        currency: TargetCurrency.BRL,
        externalId: parsed.data.withdrawalId,
        provider: 'transfero',
        status: parsed.data.status,
      },
    },
    attempt: envelope.attempt,
    success: true,
  }
}
