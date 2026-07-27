import { z } from 'zod'

export const transferoUltraDecimalSchema = z.string().regex(
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/,
  'Expected a base-10 decimal string',
)

const transferoUltraBalanceRowSchema = z.object({
  asset: z.string().min(1),
  available: transferoUltraDecimalSchema,
  blocked: transferoUltraDecimalSchema,
  credit: transferoUltraDecimalSchema,
  ledgerBalance: transferoUltraDecimalSchema,
  openDebt: transferoUltraDecimalSchema,
  openWithdrawals: transferoUltraDecimalSchema,
  overdueDebt: transferoUltraDecimalSchema,
  owedDue: transferoUltraDecimalSchema,
  processing: transferoUltraDecimalSchema,
}).loose()

export const transferoUltraBalanceResponseSchema = z.array(transferoUltraBalanceRowSchema)

export const transferoUltraWithdrawalStatusSchema = z.enum([
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'PENDING',
  'PROCESSING',
  'SETTLED',
  'RETURNED',
  'FAILED',
])

export const transferoUltraWithdrawalResponseSchema = z.object({
  amount: z.number().finite().positive(),
  fee: z.number().finite().nonnegative(),
  feePercent: z.number().finite().nonnegative(),
  id: z.string().uuid(),
  netAmount: z.number().finite().nonnegative(),
  pixKey: z.string().min(1),
  requiresApproval: z.boolean(),
  status: transferoUltraWithdrawalStatusSchema,
}).loose()

export const transferoUltraQrPreviewResponseSchema = z.object({
  amount: z.number().finite().nonnegative().nullable().optional(),
  currency: z.string().min(1),
  merchantCity: z.string().min(1).nullable().optional(),
  merchantName: z.string().min(1).nullable().optional(),
  pixKey: z.string().min(1),
  status: z.string().min(1),
  txid: z.string().min(1).nullable().optional(),
  type: z.enum(['dynamic', 'static']),
  url: z.string().min(1).nullable().optional(),
}).loose()

const transferoUltraOtcPriceSchema = z.object({
  price: z.number().finite().positive(),
}).loose()

const transferoUltraOtcSettlementGridSchema = z.object({
  D0: transferoUltraOtcPriceSchema,
  D1: transferoUltraOtcPriceSchema,
  D2: transferoUltraOtcPriceSchema,
}).loose()

export const transferoUltraOtcPricesResponseSchema = z.object({
  prices: z.record(z.string(), transferoUltraOtcSettlementGridSchema),
  spot: z.number().finite().positive(),
  timestamp: z.string().min(1),
}).loose()

export const transferoUltraOtcSessionResponseSchema = z.object({
  amount: z.number().finite().positive(),
  client_name: z.string().min(1),
  created_at: z.string().min(1),
  currency: z.enum(['USDC', 'USDT']),
  expires_at: z.string().min(1),
  price: z.number().finite().positive(),
  session_id: z.string().uuid(),
  settlement: z.enum(['D0', 'D1', 'D2']),
  side: z.enum(['BUY', 'SELL']),
  spot: z.number().finite().positive(),
  status: z.string().min(1),
  total_brl: z.number().finite().positive(),
}).loose()

export const transferoUltraOtcConfirmationResponseSchema = z.object({
  autoSettled: z.boolean().optional(),
  closing: z.object({}).loose(),
  creditSettled: z.boolean().optional(),
  trade: z.object({
    id: z.string().uuid(),
  }).loose(),
}).loose()

const transferoUltraVaultAddressSchema = z.object({
  address: z.string().min(1),
  asset: z.enum(['USDC', 'USDT']),
  blockchain: z.literal('POLYGON'),
  id: z.string().uuid(),
  network: z.string().min(1),
  tag: z.string().min(1).nullable(),
}).loose()

export const transferoUltraVaultAddressesResponseSchema = z.array(transferoUltraVaultAddressSchema)

const transferoUltraWebhookEndpointSchema = z.object({
  createdAt: z.string().min(1),
  description: z.string().nullable(),
  eventTypes: z.array(z.string().min(1)),
  id: z.string().uuid(),
  isActive: z.boolean(),
  secretPrefix: z.string().min(1),
  updatedAt: z.string().min(1),
  url: z.string().url(),
}).loose()

export const transferoUltraWebhookEndpointListSchema = z.object({
  items: z.array(transferoUltraWebhookEndpointSchema),
}).loose()
