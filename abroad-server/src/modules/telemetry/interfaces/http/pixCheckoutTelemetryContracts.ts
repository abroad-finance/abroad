import { z } from 'zod'

const PIX_CHECKOUT_BLOCKCHAINS = [
  'CELO',
  'OTHER',
  'SOLANA',
  'STELLAR',
] as const
const PIX_CHECKOUT_CHAIN_FAMILIES = [
  'evm',
  'other',
  'solana',
  'stellar',
] as const
const PIX_CHECKOUT_ENTRY_POINTS = ['manual', 'qr'] as const
const PIX_CHECKOUT_EVENT_NAMES = [
  'checkout_ready',
  'confirmation_viewed',
  'gate_blocked',
  'quote_ready',
  'submission_accepted',
  'submission_rejected',
  'submission_started',
] as const
const PIX_CHECKOUT_GATES = [
  'above_maximum',
  'amount_missing',
  'balance_pending',
  'below_minimum',
  'cpf_missing',
  'insufficient_balance',
  'pix_key_missing',
  'quote_pending',
  'quote_unavailable',
  'wallet_not_authenticated',
  'wallet_not_ready',
] as const
const PIX_CHECKOUT_SOURCE_ASSETS = ['OTHER', 'USDC', 'USDT'] as const
const PIX_CHECKOUT_STATUS_CLASSES = [
  'client_error',
  'network_error',
  'server_error',
  'unexpected',
] as const
const PIX_CHECKOUT_WALLET_SURFACES = ['minipay', 'web'] as const

export interface PixCheckoutTelemetryRequest {
  blockchain: PixCheckoutBlockchain
  chainFamily: PixCheckoutChainFamily
  entryPoint: PixCheckoutEntryPoint
  eventName: PixCheckoutEventName
  gate?: PixCheckoutGate
  rail: 'PIX'
  schemaVersion: 1
  sourceAsset: PixCheckoutSourceAsset
  statusClass?: PixCheckoutStatusClass
  targetCurrency: 'BRL'
  walletSurface: PixCheckoutWalletSurface
}
export interface PixCheckoutTelemetryResponse {
  accepted: true
}
type PixCheckoutBlockchain = typeof PIX_CHECKOUT_BLOCKCHAINS[number]
type PixCheckoutChainFamily = typeof PIX_CHECKOUT_CHAIN_FAMILIES[number]
type PixCheckoutEntryPoint = typeof PIX_CHECKOUT_ENTRY_POINTS[number]
type PixCheckoutEventName = typeof PIX_CHECKOUT_EVENT_NAMES[number]
type PixCheckoutGate = typeof PIX_CHECKOUT_GATES[number]
type PixCheckoutSourceAsset = typeof PIX_CHECKOUT_SOURCE_ASSETS[number]

type PixCheckoutStatusClass = typeof PIX_CHECKOUT_STATUS_CLASSES[number]

type PixCheckoutWalletSurface = typeof PIX_CHECKOUT_WALLET_SURFACES[number]

const pixCheckoutTelemetrySchema: z.ZodType<PixCheckoutTelemetryRequest> = z.object({
  blockchain: z.enum(PIX_CHECKOUT_BLOCKCHAINS),
  chainFamily: z.enum(PIX_CHECKOUT_CHAIN_FAMILIES),
  entryPoint: z.enum(PIX_CHECKOUT_ENTRY_POINTS),
  eventName: z.enum(PIX_CHECKOUT_EVENT_NAMES),
  gate: z.enum(PIX_CHECKOUT_GATES).optional(),
  rail: z.literal('PIX'),
  schemaVersion: z.literal(1),
  sourceAsset: z.enum(PIX_CHECKOUT_SOURCE_ASSETS),
  statusClass: z.enum(PIX_CHECKOUT_STATUS_CLASSES).optional(),
  targetCurrency: z.literal('BRL'),
  walletSurface: z.enum(PIX_CHECKOUT_WALLET_SURFACES),
}).strict().superRefine((event, context) => {
  const gateRequired = event.eventName === 'gate_blocked'
  if (gateRequired !== Boolean(event.gate)) {
    context.addIssue({
      code: 'custom',
      message: gateRequired
        ? 'gate is required for gate_blocked'
        : 'gate is only allowed for gate_blocked',
      path: ['gate'],
    })
  }

  const statusClassRequired = event.eventName === 'submission_rejected'
  if (statusClassRequired !== Boolean(event.statusClass)) {
    context.addIssue({
      code: 'custom',
      message: statusClassRequired
        ? 'statusClass is required for submission_rejected'
        : 'statusClass is only allowed for submission_rejected',
      path: ['statusClass'],
    })
  }
})

export const parsePixCheckoutTelemetry = (
  value: unknown,
): z.ZodSafeParseResult<PixCheckoutTelemetryRequest> => (
  pixCheckoutTelemetrySchema.safeParse(value)
)
