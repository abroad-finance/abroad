import { sendConsumerUxTelemetry } from '../services/public/publicApi'

export type ConsumerUxAction
  = | 'clear'
    | 'close'
    | 'continue_tracking'
    | 'copy'
    | 'download'
    | 'edit'
    | 'help'
    | 'load_more'
    | 'new_payment'
    | 'open'
    | 'refresh'
    | 'retry'
    | 'share'
    | 'switch'
    | 'view_activity'
export type ConsumerUxChain = 'CELO' | 'OTHER' | 'POLYGON' | 'SOLANA' | 'STELLAR'
export type ConsumerUxCountBucket
  = | 'eleven_to_fifty'
    | 'fifty_one_to_one_hundred'
    | 'one'
    | 'over_one_hundred'
    | 'two_to_ten'
    | 'unknown'
    | 'zero'
export type ConsumerUxDestination = 'BRAZIL_PIX_BRL' | 'COLOMBIA_BREB_COP'
export type ConsumerUxDeviceClass = 'desktop' | 'mobile' | 'tablet' | 'unknown'
export interface ConsumerUxDimensions {
  action?: ConsumerUxAction
  chain?: ConsumerUxChain
  copy_variant?: 'delayed' | 'manual_review' | 'standard' | 'unknown'
  elapsed_bucket?: ConsumerUxElapsedBucket
  entry_surface?: ConsumerUxEntrySurface
  error_category?:
    | 'invalid'
    | 'network'
    | 'required'
    | 'server'
    | 'timeout'
    | 'too_large'
    | 'unknown'
    | 'unreadable'
    | 'unsupported'
  field_category?:
    | 'address'
    | 'contact'
    | 'date_of_birth'
    | 'document'
    | 'general'
    | 'identity'
    | 'name'
  filter?:
    | 'all'
    | 'breb'
    | 'completed'
    | 'date_range'
    | 'failed'
    | 'pix'
    | 'processing'
    | 'refunded'
  immediate_reversal?: boolean
  initial_destination?: ConsumerUxDestination
  key_type?: 'alphanumeric' | 'document' | 'email' | 'phone' | 'qr' | 'unknown'
  latency_bucket?:
    | '1_to_3_seconds'
    | '250_to_1000_ms'
    | 'over_3_seconds'
    | 'under_250_ms'
    | 'unknown'
  loaded_count_bucket?: ConsumerUxCountBucket
  method?: ConsumerUxMethod
  outcome?: ConsumerUxOutcome
  rail?: ConsumerUxRail
  reference_available?: boolean
  selected_destination?: ConsumerUxDestination
  source_asset?: 'OTHER' | 'USDC' | 'USDT'
  source_surface?: 'header' | 'home' | 'journey' | 'returning_user'
  state?:
    | 'connection_lost'
    | 'minipay_disclosure'
    | 'reconnect_failed'
    | 'reconnecting'
    | 'region_unavailable'
  status?:
    | 'COMPLETED'
    | 'EXPIRED'
    | 'FAILED'
    | 'PENDING'
    | 'PROCESSING'
    | 'REFUNDED'
    | 'UNKNOWN'
  step?:
    | 'about'
    | 'activity'
    | 'authorize'
    | 'contact_address'
    | 'destination'
    | 'document_review'
    | 'pay_from'
    | 'payment_details'
    | 'progress'
    | 'receipt'
    | 'review'
  terminal_outcome?:
    | 'completed'
    | 'expired'
    | 'failed'
    | 'manual_review'
    | 'outcome_unknown'
    | 'refund_failed'
    | 'refund_pending'
    | 'refunded'
  total_count_bucket?: ConsumerUxCountBucket
  trigger_category?:
    | 'compliance_required'
    | 'document_expired'
    | 'information_required'
    | 'unknown'
  trigger_location?: 'flow' | 'header' | 'source_pill'
  wallet_category?: 'browser' | 'minipay' | 'stellar' | 'unknown' | 'walletconnect'
}
export type ConsumerUxElapsedBucket
  = | '10_to_30_seconds'
    | '30_to_60_seconds'
    | '60_to_120_seconds'
    | '120_to_180_seconds'
    | 'over_180_seconds'
    | 'under_10_seconds'
    | 'unknown'
export type ConsumerUxEntrySurface
  = | 'activity'
    | 'direct_link'
    | 'header'
    | 'home'
    | 'progress'
    | 'receipt'
export type ConsumerUxEventName
  = | 'activity_detail_restored'
    | 'activity_filter_changed'
    | 'activity_opened'
    | 'activity_page_outcome'
    | 'activity_reference_action'
    | 'activity_retry'
    | 'activity_row_opened'
    | 'conditional_service_action'
    | 'conditional_service_state_viewed'
    | 'destination_control_viewed'
    | 'destination_selected'
    | 'file_picker_opened'
    | 'header_action_clicked'
    | 'help_opened'
    | 'history_opened_from_receipt'
    | 'processing_delay_bucket_crossed'
    | 'processing_exit'
    | 'processing_state_viewed'
    | 'qr_decode_outcome'
    | 'qr_mode_impression'
    | 'qr_mode_selected'
    | 'receipt_downloaded'
    | 'receipt_reference_copied'
    | 'receipt_shared'
    | 'receipt_viewed'
    | 'recipient_correction'
    | 'recipient_entry_abandoned'
    | 'recipient_help_opened'
    | 'recipient_input_started'
    | 'recipient_method_impression'
    | 'recipient_method_selected'
    | 'recipient_method_switched'
    | 'recipient_validation_outcome'
    | 'support_opened_from_receipt'
    | 'verification_cancelled'
    | 'verification_resumed'
    | 'verification_step_viewed'
    | 'verification_submit_outcome'
    | 'verification_validation_outcome'
    | 'verification_viewed'
    | 'wallet_chain_selected'
    | 'wallet_connect_outcome'
    | 'wallet_cta_clicked'
    | 'wallet_cta_impression'
    | 'wallet_option_selected'
    | 'wallet_selector_closed'
    | 'wallet_selector_opened'
export type ConsumerUxMethod = 'camera' | 'pasted_qr' | 'payment_key' | 'uploaded_image'
export type ConsumerUxOutcome
  = | 'approved'
    | 'cancelled'
    | 'dismissed'
    | 'empty'
    | 'error'
    | 'failed'
    | 'filtered_empty'
    | 'invalid'
    | 'pending'
    | 'reconnected'
    | 'rejected'
    | 'requires_more_info'
    | 'stale'
    | 'success'
    | 'timeout'
    | 'unavailable'
    | 'unsupported'
    | 'valid'
export type ConsumerUxRail = 'BREB' | 'PIX'

export type ConsumerUxSession
  = | { key: string, kind: 'activity' }
    | { key: string, kind: 'app' }
    | { key: string, kind: 'checkout' }
    | { key: string, kind: 'verification' }

export type ConsumerUxTelemetryRequest = ConsumerUxDimensions & {
  activity_session_key?: string
  app_session_key?: string
  checkout_attempt_key?: string
  device_class: ConsumerUxDeviceClass
  event_key: string
  event_name: ConsumerUxEventName
  schema_version: 2
  ui_version: string
  verification_session_key?: string
}

type ConsumerUxEvent = {
  dimensions?: ConsumerUxDimensions
  name: ConsumerUxEventName
  session: ConsumerUxSession
}

const MAX_DEDUPE_KEYS = 512
const sentDedupeKeys = new Set<string>()
const SESSION_STORAGE_KEYS = {
  app: 'abroad.telemetry.app.v2',
  checkout: 'abroad.telemetry.checkout.v2',
} as const
let appSessionMemory: null | string = null
let checkoutSessionMemory: null | string = null
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const getCrypto = (): Crypto | null => (
  typeof globalThis.crypto === 'undefined' ? null : globalThis.crypto
)

export const createTelemetrySessionKey = (): null | string => {
  const cryptoApi = getCrypto()
  if (!cryptoApi) return null
  if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  if (typeof cryptoApi.getRandomValues !== 'function') return null

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

const getSessionStorage = (): null | Storage => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  }
  catch {
    return null
  }
}

const getOrCreateStoredSessionKey = (kind: 'app' | 'checkout'): null | string => {
  const memoryKey = kind === 'app' ? appSessionMemory : checkoutSessionMemory
  if (memoryKey) return memoryKey

  const storage = getSessionStorage()
  const stored = storage?.getItem(SESSION_STORAGE_KEYS[kind]) ?? null
  if (stored && UUID_PATTERN.test(stored)) {
    if (kind === 'app') appSessionMemory = stored
    else checkoutSessionMemory = stored
    return stored
  }
  if (stored) storage?.removeItem(SESSION_STORAGE_KEYS[kind])

  const created = createTelemetrySessionKey()
  if (!created) return null
  storage?.setItem(SESSION_STORAGE_KEYS[kind], created)
  if (kind === 'app') appSessionMemory = created
  else checkoutSessionMemory = created
  return created
}

export const getAppTelemetrySessionKey = (): null | string => (
  getOrCreateStoredSessionKey('app')
)

export const getCheckoutTelemetrySessionKey = (): null | string => (
  getOrCreateStoredSessionKey('checkout')
)

export const rotateCheckoutTelemetrySessionKey = (): null | string => {
  const created = createTelemetrySessionKey()
  checkoutSessionMemory = created
  const storage = getSessionStorage()
  if (created) storage?.setItem(SESSION_STORAGE_KEYS.checkout, created)
  else storage?.removeItem(SESSION_STORAGE_KEYS.checkout)
  return created
}

export const resolveDeviceClass = (width = globalThis.window?.innerWidth): ConsumerUxDeviceClass => {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return 'unknown'
  if (width < 768) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

export const normalizeConsumerUxRail = (value: string | undefined): ConsumerUxRail | undefined => (
  value === 'PIX' || value === 'BREB' ? value : undefined
)

export const bucketElapsedMilliseconds = (milliseconds: number): ConsumerUxElapsedBucket => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'unknown'
  if (milliseconds < 10_000) return 'under_10_seconds'
  if (milliseconds < 30_000) return '10_to_30_seconds'
  if (milliseconds < 60_000) return '30_to_60_seconds'
  if (milliseconds < 120_000) return '60_to_120_seconds'
  if (milliseconds < 180_000) return '120_to_180_seconds'
  return 'over_180_seconds'
}

export const bucketCount = (count: number): ConsumerUxCountBucket => {
  if (!Number.isSafeInteger(count) || count < 0) return 'unknown'
  if (count === 0) return 'zero'
  if (count === 1) return 'one'
  if (count <= 10) return 'two_to_ten'
  if (count <= 50) return 'eleven_to_fifty'
  if (count <= 100) return 'fifty_one_to_one_hundred'
  return 'over_one_hundred'
}

export const bucketLatencyMilliseconds = (
  milliseconds: number,
): NonNullable<ConsumerUxDimensions['latency_bucket']> => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'unknown'
  if (milliseconds < 250) return 'under_250_ms'
  if (milliseconds < 1_000) return '250_to_1000_ms'
  if (milliseconds < 3_000) return '1_to_3_seconds'
  return 'over_3_seconds'
}

const sessionField = (session: ConsumerUxSession): Pick<
  ConsumerUxTelemetryRequest,
  'activity_session_key' | 'app_session_key' | 'checkout_attempt_key' | 'verification_session_key'
> => {
  switch (session.kind) {
    case 'activity':
      return { activity_session_key: session.key }
    case 'app':
      return { app_session_key: session.key }
    case 'checkout':
      return { checkout_attempt_key: session.key }
    case 'verification':
      return { verification_session_key: session.key }
  }
}

export const buildConsumerUxTelemetryPayload = (
  event: ConsumerUxEvent,
  eventKey: string,
): ConsumerUxTelemetryRequest => ({
  ...event.dimensions,
  ...sessionField(event.session),
  device_class: resolveDeviceClass(),
  event_key: eventKey,
  event_name: event.name,
  schema_version: 2,
  ui_version: __ABROAD_UI_VERSION__,
})

export const recordConsumerUxEvent = (
  event: ConsumerUxEvent,
  options?: { onceKey?: string },
): void => {
  if (options?.onceKey && sentDedupeKeys.has(options.onceKey)) return

  const eventKey = createTelemetrySessionKey()
  if (!eventKey) return
  if (options?.onceKey) {
    if (sentDedupeKeys.size >= MAX_DEDUPE_KEYS) sentDedupeKeys.clear()
    sentDedupeKeys.add(options.onceKey)
  }

  try {
    void sendConsumerUxTelemetry(buildConsumerUxTelemetryPayload(event, eventKey))
      // This channel is deliberately fail-open: checkout remains authoritative.
      .catch(() => undefined)
  }
  catch {
    // Synchronous transport setup failures must not interrupt a payment journey.
  }
}

export const resetConsumerUxTelemetryDedupeForTests = (): void => {
  sentDedupeKeys.clear()
  appSessionMemory = null
  checkoutSessionMemory = null
}
