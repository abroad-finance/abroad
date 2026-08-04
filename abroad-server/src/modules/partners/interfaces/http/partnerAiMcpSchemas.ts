import { z } from 'zod'

import { partnerAiScopeNames } from '../../application/partnerAiScopes'

// Output schemas are deliberately looser than the input schemas for the same
// enums. An unknown value in a *filter* should be rejected, but an unknown
// value in a *result* means a database enum grew without this file being
// updated, and the MCP SDK turns that into a hard tool failure. Describing the
// known values keeps the contract useful without making a payments read break
// on a migration.
const transactionStatus = z.string()
  .describe('AWAITING_PAYMENT, PROCESSING_PAYMENT, PAYMENT_FAILED, PAYMENT_EXPIRED, PAYMENT_COMPLETED, or WRONG_AMOUNT')
const outboxStatus = z.string().describe('PENDING, DELIVERING, DELIVERED, or FAILED')
const isoTimestamp = z.string().describe('ISO 8601 timestamp')

const transactionQuote = z.object({
  country: z.string(),
  cryptoCurrency: z.string(),
  network: z.string(),
  paymentMethod: z.string(),
  sourceAmount: z.number().describe('Amount debited in the source cryptocurrency'),
  targetAmount: z.number().describe('Amount delivered in the target fiat currency'),
  targetCurrency: z.string(),
})

const transactionSummary = z.object({
  createdAt: isoTimestamp,
  id: z.string(),
  onChainId: z.string().nullable().describe('Settlement transaction hash once funds move on chain'),
  quote: transactionQuote,
  status: transactionStatus,
  userReference: z.string().describe('The partner-supplied user id this transaction belongs to'),
})

export const accountMetadataOutputSchema = {
  connectionId: z.string(),
  organizationName: z.string(),
  resource: z.string(),
  scopes: z.array(z.enum(partnerAiScopeNames)),
  serverVersion: z.string(),
  status: z.literal('ACTIVE'),
}

export const documentationOutputSchema = {
  matched: z.boolean().describe('False when nothing matched and the documentation index is returned instead'),
  note: z.string().optional(),
  results: z.array(z.object({
    excerpt: z.string(),
    title: z.string(),
    url: z.string(),
  })),
}

export const transactionDetailOutputSchema = {
  ...transactionSummary.shape,
  deliveries: z.array(z.object({
    attempts: z.number(),
    canRedeliver: z.boolean(),
    durationMs: z.number().nullable(),
    event: z.string(),
    failureCode: z.string().nullable(),
    httpStatus: z.number().nullable(),
    id: z.string(),
    lastAttemptAt: isoTimestamp,
    nextAttemptAt: isoTimestamp.nullable(),
    purpose: z.string().describe('TRANSACTION, TEST, or REDELIVERY'),
    sourceDeliveryId: z.string().nullable(),
    status: outboxStatus,
  })).describe('Recent webhook deliveries for this transaction, newest first'),
  failureReason: z.string().nullable().describe('Partner-safe failure explanation, only set when status is PAYMENT_FAILED'),
  lifecycle: z.array(z.object({
    occurredAt: isoTimestamp,
    status: transactionStatus,
    type: z.enum(['CREATED', 'STATUS_CHANGED']),
  })),
  payoutDestinationHint: z.string().nullable().describe('Masked payout account, last four characters only'),
  pixEndToEndId: z.string().nullable().describe('PIX E2E identifier, only set for PIX payouts'),
  refund: z.object({
    onChainId: z.string().nullable(),
    status: z.enum(['COMPLETED', 'FAILED', 'NOT_STARTED', 'PROCESSING']),
  }).nullable(),
}

export const transactionListOutputSchema = {
  items: z.array(transactionSummary),
  page: z.number(),
  pageSize: z.number(),
  statusCounts: z.array(z.object({
    count: z.number(),
    status: transactionStatus,
  })).describe('Counts across the whole filtered set, ignoring the status filter'),
  total: z.number(),
}

export const validationOutputSchema = {
  issues: z.array(z.object({
    code: z.string(),
    message: z.string(),
    path: z.string().describe('Dot-separated path to the offending field'),
  })),
  valid: z.boolean(),
}

export const webhookDiagnosticsOutputSchema = {
  configured: z.boolean().describe('Whether a webhook URL is configured for this organization'),
  deliveries: z.array(z.object({
    count: z.number(),
    status: outboxStatus,
  })),
  destinationHost: z.string().nullable().describe('Hostname only; the full URL is never exposed'),
  latest: z.object({
    attemptedAt: isoTimestamp,
    durationMs: z.number().nullable(),
    failureCode: z.enum(['DELIVERY_FAILED', 'HTTP_REJECTED']).nullable(),
    httpStatus: z.number().nullable(),
    status: outboxStatus,
  }).nullable(),
  lookbackHours: z.number(),
}
