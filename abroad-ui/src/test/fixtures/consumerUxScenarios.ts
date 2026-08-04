import type {
  _36EnumsBlockchainNetwork,
  _36EnumsCryptoCurrency,
  _36EnumsPaymentMethod,
  _36EnumsTransactionStatus,
  ConsumerActivityReceiptDto,
  ConsumerActivityTransactionDto,
} from '../../api'

export const SYNTHETIC_ACTIVITY_DATASET_SIZES = [
  0,
  1,
  2,
  10,
  11,
  50,
  72,
  500,
] as const

const ACTIVITY_STATUSES = [
  'AWAITING_PAYMENT',
  'PROCESSING_PAYMENT',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'PAYMENT_COMPLETED',
  'WRONG_AMOUNT',
] as const satisfies readonly _36EnumsTransactionStatus[]

const NETWORKS = [
  'STELLAR',
  'SOLANA',
  'CELO',
] as const satisfies readonly _36EnumsBlockchainNetwork[]

const SOURCE_ASSETS = ['USDC', 'USDT'] as const satisfies readonly _36EnumsCryptoCurrency[]

const RAILS = ['PIX', 'BREB'] as const satisfies readonly _36EnumsPaymentMethod[]

const SOURCE_AMOUNTS = [
  0.01,
  1,
  123.456789,
  9_999_999.99,
] as const

const syntheticUuid = (index: number): string => (
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
)

const syntheticTimestamp = (index: number): string => (
  new Date(Date.UTC(2026, 0, 1, 12, index % 60, index % 60)).toISOString()
)

export const buildSyntheticActivityRows = (
  count: number,
): ConsumerActivityTransactionDto[] => {
  if (!Number.isInteger(count) || count < 0 || count > 500) {
    throw new RangeError('Synthetic Activity row count must be an integer from 0 to 500')
  }

  return Array.from({ length: count }, (_, index) => {
    const status = ACTIVITY_STATUSES[index % ACTIVITY_STATUSES.length]
    const network = NETWORKS[index % NETWORKS.length]
    const sourceCurrency = SOURCE_ASSETS[index % SOURCE_ASSETS.length]
    const paymentMethod = RAILS[index % RAILS.length]
    const sourceAmount = SOURCE_AMOUNTS[index % SOURCE_AMOUNTS.length]
    const targetCurrency = paymentMethod === 'PIX' ? 'BRL' : 'COP'
    const targetAmount = paymentMethod === 'PIX'
      ? Number((sourceAmount * 5.123456).toFixed(2))
      : Number((sourceAmount * 4_123.456789).toFixed(2))
    const createdAt = syntheticTimestamp(index)
    const completedAt = status === 'PAYMENT_COMPLETED' ? syntheticTimestamp(index + 1) : null
    const refundStatus = status === 'PAYMENT_FAILED'
      ? 'PROCESSING'
      : status === 'PAYMENT_EXPIRED'
        ? 'NOT_STARTED'
        : 'NOT_APPLICABLE'

    return {
      id: syntheticUuid(index),
      proof: {
        receiptAvailable: status === 'PAYMENT_COMPLETED' && index % 2 === 1,
        status: status === 'PAYMENT_COMPLETED'
          ? index % 2 === 1 ? 'AVAILABLE' : 'MISSING'
          : status === 'PROCESSING_PAYMENT' ? 'PENDING' : 'NOT_APPLICABLE',
      },
      quote: {
        country: paymentMethod === 'PIX' ? 'BR' : 'CO',
        network,
        paymentMethod,
        sourceAmount,
        sourceCurrency,
        targetAmount,
        targetCurrency,
      },
      recipientHint: index % 7 === 0 ? null : `Synthetic recipient •••• ${String(index % 10_000).padStart(4, '0')}`,
      refund: {
        reference: refundStatus === 'PROCESSING' && index % 2 === 0
          ? `synthetic-refund-${index}`
          : null,
        status: refundStatus,
      },
      status,
      timestamps: {
        acceptedAt: createdAt,
        completedAt,
        createdAt,
        lastReconciledAt: index % 3 === 0 ? syntheticTimestamp(index + 2) : null,
        payoutSubmittedAt: status === 'PROCESSING_PAYMENT' || status === 'PAYMENT_COMPLETED'
          ? syntheticTimestamp(index + 1)
          : null,
        updatedAt: completedAt ?? syntheticTimestamp(index + 1),
      },
    }
  })
}

export const buildSyntheticActivityReceipt = (
  index: number,
): ConsumerActivityReceiptDto => {
  const row = buildSyntheticActivityRows(index + 1)[index]
  if (!row) {
    throw new RangeError('Synthetic receipt index is out of range')
  }

  const allReferencesAvailable = index % 3 !== 0
  return {
    ...row,
    effectiveRate: index % 3 === 0 ? null : row.quote.paymentMethod === 'PIX' ? '5.123456' : '4123.456789',
    fee: index % 3 === 0
      ? null
      : {
          amount: index % 2 === 0 ? '1.25' : '0.75',
          currency: row.quote.targetCurrency,
          type: index % 2 === 0 ? 'FIXED' : 'PERCENTAGE',
        },
    lifecycle: [{
      occurredAt: row.timestamps.createdAt,
      status: 'AWAITING_PAYMENT',
      type: 'CREATED',
    }, {
      occurredAt: row.timestamps.updatedAt,
      status: row.status,
      type: 'STATUS_CHANGED',
    }],
    references: {
      abroadId: row.id,
      brebId: allReferencesAvailable && row.quote.paymentMethod === 'BREB'
        ? `synthetic-breb-${index}`
        : null,
      onChainId: allReferencesAvailable ? `synthetic-chain-${index}` : null,
      pixEndToEndId: allReferencesAvailable && row.quote.paymentMethod === 'PIX'
        ? `synthetic-pix-e2e-${index}`
        : null,
      providerId: allReferencesAvailable ? `synthetic-provider-${index}` : null,
      refundOnChainId: row.refund.status === 'COMPLETED'
        ? `synthetic-refund-chain-${index}`
        : null,
    },
  }
}

export const SYNTHETIC_UNKNOWN_ACTIVITY_STATUS = 'SYNTHETIC_UNKNOWN_STATUS'

export const SYNTHETIC_ACTIVITY_PAGE_STATES = [
  'loading',
  'refreshing',
  'empty',
  'filtered_empty',
  'ready',
  'error',
  'stale',
  'offline',
] as const

export const SYNTHETIC_ACTIVITY_FILTERS = [
  'all',
  'rail',
  'network',
  'status',
  'date_range',
] as const

export const SYNTHETIC_KYC_SCENARIOS = [
  { outcome: 'editing', step: 'about', upload: 'empty' },
  { outcome: 'validation_error', step: 'about', upload: 'empty' },
  { outcome: 'editing', step: 'contact', upload: 'empty' },
  { outcome: 'editing', step: 'document', upload: 'valid' },
  { outcome: 'validation_error', step: 'document', upload: 'empty' },
  { outcome: 'validation_error', step: 'document', upload: 'too_large' },
  { outcome: 'validation_error', step: 'document', upload: 'unsupported' },
  { outcome: 'upload_error', step: 'document', upload: 'retry' },
  { outcome: 'editing', step: 'document', upload: 'replace' },
  { outcome: 'editing', step: 'document', upload: 'remove' },
  { outcome: 'submitting', step: 'document', upload: 'valid' },
  { outcome: 'in_review', step: 'document_review', upload: 'valid' },
  { outcome: 'requires_more_info', step: 'document_review', upload: 'replace' },
  { outcome: 'approved', step: 'document_review', upload: 'valid' },
  { outcome: 'rejected', step: 'document_review', upload: 'valid' },
  { outcome: 'expired', step: 'document_review', upload: 'replace' },
  { outcome: 'unavailable', step: 'document_review', upload: 'valid' },
  { outcome: 'cancelled', step: 'about', upload: 'empty' },
  { outcome: 'resumed', step: 'about', upload: 'empty' },
] as const

export const SYNTHETIC_CONDITIONAL_STATES = [
  'region_unavailable',
  'connection_lost',
  'reconnecting',
  'reconnect_failed',
  'minipay_disclosure',
] as const

export const SYNTHETIC_VIEWPORTS = [
  { height: 568, label: 'compact-mobile', width: 320 },
  { height: 800, label: 'mobile', width: 360 },
  { height: 844, label: 'large-mobile', width: 390 },
  { height: 390, label: 'mobile-landscape', width: 844 },
  { height: 1024, label: 'tablet', width: 768 },
  { height: 640, label: 'short-desktop', width: 1280 },
] as const

export const SYNTHETIC_ZOOM_LEVELS = [
  100,
  200,
  400,
] as const

export const SYNTHETIC_ACCESS_MODES = [
  'keyboard',
  'screen_reader',
  'reduced_motion',
] as const
