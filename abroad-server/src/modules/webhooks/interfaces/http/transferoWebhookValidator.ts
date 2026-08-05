import { TargetCurrency } from '@prisma/client'
import { z } from 'zod'

import { FiatDepositReceivedMessage, PaymentStatusUpdatedMessage } from '../../../../platform/messaging/queueSchema'
import { transferoUltraDecimalSchema, transferoUltraWithdrawalStatusSchema } from '../../../transfero/infrastructure/transferoUltraSchemas'

const transferoUltraWebhookEnvelopeSchema = z.object({
  attempt: z.number().int().positive(),
  data: z.unknown(),
  deliveredAt: z.string().min(1),
  endClientId: z.string().min(1).optional(),
  // Ultra does not use a bare UUID for every event. PIX withdrawals arrive as
  // a plain UUID, but crypto and deposit events are prefixed with the event
  // name (`crypto_deposit_confirmed_<uuid>`). Requiring a UUID here rejected
  // every crypto.deposit.confirmed delivery with a 400.
  eventId: z.string().min(1).max(200),
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

const transferoUltraPixDepositDataSchema = z.object({
  amount: transferoUltraDecimalSchema,
  currency: z.literal('BRL'),
  depositId: z.string().min(1),
  endToEndId: z.string().nullable(),
  // Ultra's own attribution field, which we set to our transaction id when the
  // dynamic QR is created. Nullable by contract, so it is never assumed.
  endUserId: z.string().min(1).nullable().optional(),
  payer: z.object({
    bankCode: z.string().nullable(),
    name: z.string().nullable(),
    taxId: z.string().nullable(),
  }).loose().nullable().optional(),
  status: z.string().min(1),
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
const MAX_PROVIDER_FAILURE_REASON_LENGTH = 500

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
    action: 'fiat-deposit-received'
    eventId: string
    eventType: string
    message: FiatDepositReceivedMessage
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
    // Only a completed deposit is spendable. `pix.deposit.paid` means the money
    // arrived but the credit has not landed, so it deliberately does not start
    // a delivery — Ultra docs §10.
    case 'pix.deposit.completed':
      return parsePixDeposit(envelope)
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

function normalizeProviderFailureReason(value: null | string): null | string {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, MAX_PROVIDER_FAILURE_REASON_LENGTH) : null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parsePixDeposit(
  envelope: z.infer<typeof transferoUltraWebhookEnvelopeSchema>,
): TransferoUltraWebhookValidationResult {
  const parsed = transferoUltraPixDepositDataSchema.safeParse(envelope.data)
  if (!parsed.success) {
    return { errors: JSON.stringify(parsed.error.issues), success: false }
  }
  if (parsed.data.status !== 'COMPLETED') {
    return {
      errors: `Webhook event ${envelope.eventType} carried status ${parsed.data.status}`,
      success: false,
    }
  }

  // Attribution is best-effort by contract, so an unattributed deposit is
  // routed nowhere rather than guessed at. It still credited our balance; ops
  // reconciles it from the provider side.
  const transactionId = parsed.data.endUserId?.trim()
  if (!transactionId || !UUID_PATTERN.test(transactionId)) {
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

  const amount = Number(parsed.data.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { errors: 'Deposit amount is not a finite positive number', success: false }
  }

  return {
    action: {
      action: 'fiat-deposit-received',
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      message: {
        amount,
        currency: TargetCurrency.BRL,
        endToEndId: parsed.data.endToEndId?.trim() || null,
        payerTaxId: parsed.data.payer?.taxId?.replace(/\D+/g, '') || null,
        provider: 'transfero',
        providerDepositId: parsed.data.depositId,
        transactionId,
      },
    },
    attempt: envelope.attempt,
    success: true,
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
        failureReason: normalizeProviderFailureReason(parsed.data.failureReason),
        pixEndToEndId: parsed.data.endToEndId?.trim() || null,
        provider: 'transfero',
        status: parsed.data.status,
      },
    },
    attempt: envelope.attempt,
    success: true,
  }
}
