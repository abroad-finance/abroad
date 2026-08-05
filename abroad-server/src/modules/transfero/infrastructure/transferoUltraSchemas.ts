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
  'HELD_FOR_REVIEW',
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

export const transferoUltraWithdrawalDetailResponseSchema = z.object({
  amount: z.number().finite().positive().optional(),
  endToEndId: z.string().trim().min(1).max(128).nullable(),
  fee: z.number().finite().nonnegative().optional(),
  id: z.string().uuid(),
  netAmount: z.number().finite().nonnegative().optional(),
  status: transferoUltraWithdrawalStatusSchema,
}).loose()

export const transferoUltraQrPreviewResponseSchema = z.object({
  amount: z.number().finite().nonnegative().nullable().optional(),
  currency: z.string().min(1),
  merchantCity: z.string().min(1).nullable().optional(),
  merchantName: z.string().min(1).nullable().optional(),
  // Ultra omits the key on previews it resolves by location instead of by key
  // (payment-initiator BR codes), so a null here is a normal payable preview,
  // not a schema drift. Demanding a string rejected valid QR codes outright.
  pixKey: z.string().min(1).nullable(),
  status: z.string().min(1).nullable(),
  txid: z.string().min(1).nullable().optional(),
  type: z.enum(['dynamic', 'static']),
  url: z.string().min(1).nullable().optional(),
}).loose()

const transferoUltraOtcPriceSchema = z.object({
  price: z.number().finite().positive(),
}).loose()

const transferoUltraOtcSettlementGridSchema = z.object({
  D0: transferoUltraOtcPriceSchema,
  D1: transferoUltraOtcPriceSchema.optional(),
  D2: transferoUltraOtcPriceSchema.optional(),
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
  session_id: z.string().min(1).max(128),
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

export const transferoUltraHoldingsSettlementResponseSchema = z.object({
  swept: transferoUltraDecimalSchema,
}).loose()

export const transferoUltraOtcTradeDetailResponseSchema = z.object({
  trade: z.object({
    amountUsd: transferoUltraDecimalSchema,
    cryptoReceived: transferoUltraDecimalSchema,
    currency: z.enum(['USDC', 'USDT']),
    id: z.string().uuid(),
    price: z.union([transferoUltraDecimalSchema, z.number().finite().positive()]).optional(),
    side: z.enum(['BUY', 'SELL']),
    total_brl: z.union([transferoUltraDecimalSchema, z.number().finite().positive()]).optional(),
    totalBrl: z.union([transferoUltraDecimalSchema, z.number().finite().positive()]).optional(),
  }).loose(),
}).loose()

// Ultra deposit lifecycle. PENDING is an unpaid QR; PAID means the PIX arrived
// but is not necessarily ours yet; only COMPLETED means the BRZ credit landed
// and the balance is spendable.
const transferoUltraDepositStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'PAID',
  'COMPLETED',
  'EXPIRED',
  'REFUNDED',
  'FAILED',
])

const transferoUltraDepositPayerSchema = z.object({
  bankCode: z.string().min(1).nullable(),
  name: z.string().min(1).nullable(),
  taxId: z.string().min(1).nullable(),
}).loose()

// Pinned against the live endpoint, which returns
// { id, amount, qrCode, qrCodeBase64, expiresAt, status, blockchainFee, endUserId }.
// The deposit id is `id`, not `depositId`, and the payable EMV payload is
// `qrCode` — there is no `brCode`/`emvPayload` field and no `txid` anywhere in
// the exchange: the txid the PIX spec talks about is minted by Ultra, and
// sending one is rejected outright as an unrecognised key.
export const transferoUltraDynamicQrResponseSchema = z.object({
  amount: z.union([transferoUltraDecimalSchema, z.number().finite().positive()]),
  endUserId: z.string().min(1).nullable().optional(),
  expiresAt: z.string().min(1).nullable().optional(),
  id: z.string().min(1),
  qrCode: z.string().min(1),
  status: transferoUltraDepositStatusSchema,
}).loose()

// Pinned against the live endpoint. Note the expiry is `qrCodeExpiresAt` here
// even though the creation response calls the same instant `expiresAt`.
export const transferoUltraDepositDetailResponseSchema = z.object({
  amount: z.union([transferoUltraDecimalSchema, z.number().finite().nonnegative()]),
  confirmedAt: z.string().min(1).nullable().optional(),
  currency: z.literal('BRL'),
  endToEndId: z.string().trim().min(1).max(128).nullable().optional(),
  endUserId: z.string().min(1).nullable().optional(),
  id: z.string().min(1),
  paidAt: z.string().min(1).nullable().optional(),
  payer: transferoUltraDepositPayerSchema.nullable().optional(),
  qrCodeExpiresAt: z.string().min(1).nullable().optional(),
  qrCodeType: z.enum(['DYNAMIC', 'STATIC']).nullable().optional(),
  refundedAt: z.string().min(1).nullable().optional(),
  status: transferoUltraDepositStatusSchema,
}).loose()

export const transferoUltraRefundResponseSchema = z.object({
  amount: z.union([transferoUltraDecimalSchema, z.number().finite().positive()]).optional(),
  depositId: z.string().min(1).optional(),
  id: z.string().min(1),
  status: z.string().min(1),
}).loose()

export const transferoUltraCryptoWithdrawalResponseSchema = z.object({
  amount: z.union([transferoUltraDecimalSchema, z.number().finite().positive()]),
  asset: z.enum(['USDC', 'USDT']),
  blockchain: z.string().min(1),
  fee: z.union([transferoUltraDecimalSchema, z.number().finite().nonnegative()]).optional(),
  status: z.enum([
    'PENDING_APPROVAL',
    'SUBMITTED',
    'BROADCASTING',
    'CONFIRMING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),
  toAddress: z.string().min(1),
  transactionId: z.string().min(1),
  txHash: z.string().min(1).nullable().optional(),
}).loose()

const transferoUltraVaultAddressSchema = z.object({
  address: z.string().min(1),
  asset: z.string().min(1),
  blockchain: z.string().min(1),
  id: z.string().uuid(),
  network: z.string().min(1),
  tag: z.preprocess(
    value => typeof value === 'string' && value.trim().length === 0 ? null : value,
    z.string().min(1).nullable(),
  ),
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
