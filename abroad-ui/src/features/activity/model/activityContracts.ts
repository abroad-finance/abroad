import { z } from 'zod'

import type {
  ConsumerActivityListResponse,
  ConsumerActivityReceiptDto,
  ConsumerActivityTransactionDto,
} from '@/api'

const transactionStatusSchema = z.enum([
  'AWAITING_PAYMENT',
  'PROCESSING_PAYMENT',
  'PAYMENT_COMPLETED',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'WRONG_AMOUNT',
])
const paymentMethodSchema = z.enum([
  'BREB',
  'MOVII',
  'NEQUI',
  'PIX',
])
const networkSchema = z.enum([
  'CELO',
  'SOLANA',
  'STELLAR',
])
const sourceCurrencySchema = z.enum(['USDC', 'USDT'])
const targetCurrencySchema = z.enum(['BRL', 'COP'])
const countrySchema = z.enum(['BR', 'CO'])
const isoTimestampSchema = z.string().datetime({ offset: true })
const nullableTimestampSchema = isoTimestampSchema.nullable()
const nonnegativeAmountSchema = z.number().finite().nonnegative()
const boundedReferenceSchema = z.string().trim().min(1).max(256)
const nullableReferenceSchema = boundedReferenceSchema.nullable()
const decimalStringSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine(value => Number.isFinite(Number(value)))

const quoteSchema = z.object({
  country: countrySchema,
  network: networkSchema,
  paymentMethod: paymentMethodSchema,
  sourceAmount: nonnegativeAmountSchema,
  sourceCurrency: sourceCurrencySchema,
  targetAmount: nonnegativeAmountSchema,
  targetCurrency: targetCurrencySchema,
}).superRefine((quote, context) => {
  const isBrazilPix = quote.country === 'BR'
    && quote.targetCurrency === 'BRL'
    && quote.paymentMethod === 'PIX'
  const isColombiaRail = quote.country === 'CO'
    && quote.targetCurrency === 'COP'
    && quote.paymentMethod !== 'PIX'
  if (!isBrazilPix && !isColombiaRail) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid activity corridor' })
  }
})

const transactionShape = {
  id: z.string().uuid(),
  proof: z.object({
    receiptAvailable: z.boolean(),
    status: z.enum([
      'AVAILABLE',
      'MISSING',
      'NOT_APPLICABLE',
      'PENDING',
    ]),
  }),
  quote: quoteSchema,
  recipientHint: z.string().trim().min(1).max(32).nullable(),
  refund: z.object({
    reference: nullableReferenceSchema,
    status: z.enum([
      'COMPLETED',
      'FAILED',
      'NOT_APPLICABLE',
      'NOT_STARTED',
      'PROCESSING',
      'UNKNOWN',
    ]),
  }),
  status: transactionStatusSchema,
  timestamps: z.object({
    acceptedAt: isoTimestampSchema,
    completedAt: nullableTimestampSchema,
    createdAt: isoTimestampSchema,
    lastReconciledAt: nullableTimestampSchema,
    payoutSubmittedAt: nullableTimestampSchema,
    updatedAt: isoTimestampSchema,
  }),
}

const consumerActivityTransactionSchema: z.ZodType<ConsumerActivityTransactionDto> = z.object(
  transactionShape,
)

const consumerActivityReceiptSchema: z.ZodType<ConsumerActivityReceiptDto> = z.object({
  ...transactionShape,
  effectiveRate: decimalStringSchema.nullable(),
  fee: z.object({
    amount: decimalStringSchema,
    currency: sourceCurrencySchema,
    type: z.enum([
      'COMBINED',
      'FIXED',
      'NETWORK',
      'NONE',
      'PERCENTAGE',
    ]),
  }).nullable(),
  lifecycle: z.array(z.object({
    occurredAt: isoTimestampSchema,
    status: transactionStatusSchema,
    type: z.enum(['CREATED', 'STATUS_CHANGED']),
  })).max(200),
  references: z.object({
    abroadId: z.string().uuid(),
    brebId: nullableReferenceSchema,
    onChainId: nullableReferenceSchema,
    pixEndToEndId: nullableReferenceSchema,
    providerId: nullableReferenceSchema,
    refundOnChainId: nullableReferenceSchema,
  }),
})

const consumerActivityListSchema: z.ZodType<ConsumerActivityListResponse> = z.object({
  items: z.array(consumerActivityTransactionSchema).max(50),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(50),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})

export const parseConsumerActivityList = (value: unknown): ConsumerActivityListResponse => (
  consumerActivityListSchema.parse(value)
)

export const parseConsumerActivityReceipt = (value: unknown): ConsumerActivityReceiptDto => (
  consumerActivityReceiptSchema.parse(value)
)
