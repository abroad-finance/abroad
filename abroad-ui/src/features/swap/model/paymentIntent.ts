import { z } from 'zod'

import type { QrEntryMode, SwapView } from '../types'
import type { QuoteSnapshot } from './quote'

import { quoteSnapshotSchema } from './quote'

export type PaymentAuthorizationState
  = | { kind: 'accepted', transactionId: string }
    | { kind: 'authorizing', transactionId: string }
    | { kind: 'broadcast-confirmed', onChainId: string, transactionId: string }
    | { kind: 'broadcast-unknown', transactionId: string }
    | { kind: 'wallet-rejected', transactionId: string }

export type PaymentDestination
  = | { country: 'BR', currency: 'BRL', rail: 'PIX' }
    | { country: 'CO', currency: 'COP', rail: 'BREB' }

export type PaymentRecipient
  = | { kind: 'breb-key', value: string }
    | { kind: 'breb-qr', mode: QrEntryMode, payload: string }
    | { kind: 'pix-key', value: string }
    | { kind: 'pix-qr', mode: QrEntryMode, payload: string }

export type PendingWalletIntent
  = | {
    destination: PaymentDestination
    kind: 'decode-qr'
    mode: QrEntryMode
    payload: string
  }
  | {
    destination: PaymentDestination
    kind: 'review-manual'
    targetAmount: string
  }

const paymentContextSnapshotSchema = z.object({
  amount: z.number().finite().positive(),
  blockchain: z.enum([
    'CELO',
    'SOLANA',
    'STELLAR',
  ]),
  chainFamily: z.enum([
    'evm',
    'solana',
    'stellar',
  ]),
  chainId: z.string().min(1).max(128),
  cryptoCurrency: z.enum(['USDC', 'USDT']),
  decimals: z.number().int().min(0).max(18).nullable(),
  depositAddress: z.string().min(1).max(256),
  memo: z.string().max(256).nullable(),
  memoType: z.literal('text').nullable(),
  mintAddress: z.string().max(256).nullable(),
  notify: z.object({
    endpoint: z.string().max(2048).nullable(),
    required: z.boolean(),
  }).strict(),
  rpcUrl: z.string().max(2048).nullable(),
}).strict()

const paymentAuthorizationStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), transactionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('authorizing'), transactionId: z.string().uuid() }).strict(),
  z.object({
    kind: z.literal('broadcast-confirmed'),
    onChainId: z.string().min(1).max(256),
    transactionId: z.string().uuid(),
  }).strict(),
  z.object({ kind: z.literal('broadcast-unknown'), transactionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('wallet-rejected'), transactionId: z.string().uuid() }).strict(),
])

export type PaymentContextSnapshot = z.infer<typeof paymentContextSnapshotSchema>

export type RestorableAcceptedPayment = {
  authorization: PaymentAuthorizationState
  paymentContext: null | PaymentContextSnapshot
  transactionReference: null | string
}

const restorableAcceptedPaymentSchema = z.object({
  authorization: paymentAuthorizationStateSchema,
  paymentContext: paymentContextSnapshotSchema.nullable(),
  transactionReference: z.string().max(256).nullable(),
}).strict()

export type RestorablePaymentDraft = {
  acceptedPayment: null | RestorableAcceptedPayment
  corridorKey: string
  destination: PaymentDestination
  quote: null | QuoteSnapshot
  schemaVersion: 4
  sourceAmount: string
  targetAmount: string
  view: SwapView
}

const supportedViews = [
  'confirm-qr',
  'home',
  'kyc-needed',
  'swap',
  'txStatus',
  'wait-sign',
] as const satisfies readonly SwapView[]

const destinationSchema = z.discriminatedUnion('country', [z.object({ country: z.literal('BR'), currency: z.literal('BRL'), rail: z.literal('PIX') }).strict(), z.object({ country: z.literal('CO'), currency: z.literal('COP'), rail: z.literal('BREB') }).strict()])

const restorablePaymentDraftSchema = z.object({
  acceptedPayment: restorableAcceptedPaymentSchema.nullable(),
  corridorKey: z.string().max(256),
  destination: destinationSchema,
  quote: quoteSnapshotSchema.nullable(),
  schemaVersion: z.literal(4),
  sourceAmount: z.string().max(80),
  targetAmount: z.string().max(80),
  view: z.enum(supportedViews),
}).strict()

export const destinationForCurrency = (currency: 'BRL' | 'COP'): PaymentDestination => (
  currency === 'BRL'
    ? { country: 'BR', currency: 'BRL', rail: 'PIX' }
    : { country: 'CO', currency: 'COP', rail: 'BREB' }
)

export const recipientMatchesDestination = (
  destination: PaymentDestination,
  recipient: PaymentRecipient,
): boolean => (
  destination.rail === 'PIX'
    ? recipient.kind === 'pix-key' || recipient.kind === 'pix-qr'
    : recipient.kind === 'breb-key' || recipient.kind === 'breb-qr'
)

export const canRetryWalletAuthorization = (state: PaymentAuthorizationState): boolean => (
  state.kind === 'accepted' || state.kind === 'wallet-rejected'
)

export const shouldReconcileBeforeAction = (state: PaymentAuthorizationState): boolean => (
  state.kind === 'broadcast-confirmed' || state.kind === 'broadcast-unknown'
)

export const parsePaymentContextSnapshot = (value: unknown): null | PaymentContextSnapshot => {
  const parsed = paymentContextSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const parseRestorablePaymentDraft = (value: unknown): null | RestorablePaymentDraft => {
  const parsed = restorablePaymentDraftSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
