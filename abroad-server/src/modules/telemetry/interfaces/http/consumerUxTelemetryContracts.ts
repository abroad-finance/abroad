import { z } from 'zod'

const ACTIONS = [
  'clear',
  'close',
  'continue_tracking',
  'copy',
  'download',
  'edit',
  'help',
  'load_more',
  'new_payment',
  'open',
  'refresh',
  'retry',
  'share',
  'switch',
  'view_activity',
] as const
const CHAINS = ['CELO', 'OTHER', 'POLYGON', 'SOLANA', 'STELLAR'] as const
const COPY_VARIANTS = ['delayed', 'manual_review', 'standard', 'unknown'] as const
const DESTINATIONS = ['BRAZIL_PIX_BRL', 'COLOMBIA_BREB_COP'] as const
const DEVICE_CLASSES = ['desktop', 'mobile', 'tablet', 'unknown'] as const
const ELAPSED_BUCKETS = [
  '10_to_30_seconds',
  '120_to_180_seconds',
  '30_to_60_seconds',
  '60_to_120_seconds',
  'over_180_seconds',
  'under_10_seconds',
  'unknown',
] as const
const ENTRY_SURFACES = [
  'activity',
  'direct_link',
  'header',
  'home',
  'progress',
  'receipt',
] as const
const ERROR_CATEGORIES = [
  'invalid',
  'network',
  'required',
  'server',
  'timeout',
  'too_large',
  'unknown',
  'unreadable',
  'unsupported',
] as const
const EVENT_NAMES = [
  'activity_detail_restored',
  'activity_filter_changed',
  'activity_opened',
  'activity_page_outcome',
  'activity_reference_action',
  'activity_retry',
  'activity_row_opened',
  'conditional_service_action',
  'conditional_service_state_viewed',
  'destination_control_viewed',
  'destination_selected',
  'file_picker_opened',
  'header_action_clicked',
  'help_opened',
  'history_opened_from_receipt',
  'processing_delay_bucket_crossed',
  'processing_exit',
  'processing_state_viewed',
  'qr_decode_outcome',
  'qr_mode_impression',
  'qr_mode_selected',
  'receipt_downloaded',
  'receipt_reference_copied',
  'receipt_shared',
  'receipt_viewed',
  'recipient_correction',
  'recipient_entry_abandoned',
  'recipient_help_opened',
  'recipient_input_started',
  'recipient_method_impression',
  'recipient_method_selected',
  'recipient_method_switched',
  'recipient_validation_outcome',
  'support_opened_from_receipt',
  'verification_cancelled',
  'verification_resumed',
  'verification_step_viewed',
  'verification_submit_outcome',
  'verification_validation_outcome',
  'verification_viewed',
  'wallet_chain_selected',
  'wallet_connect_outcome',
  'wallet_cta_clicked',
  'wallet_cta_impression',
  'wallet_option_selected',
  'wallet_selector_closed',
  'wallet_selector_opened',
] as const
const FIELD_CATEGORIES = [
  'address',
  'contact',
  'date_of_birth',
  'document',
  'general',
  'identity',
  'name',
] as const
const FILTERS = [
  'all',
  'breb',
  'completed',
  'date_range',
  'failed',
  'pix',
  'processing',
  'refunded',
] as const
const KEY_TYPES = ['alphanumeric', 'document', 'email', 'phone', 'qr', 'unknown'] as const
const LATENCY_BUCKETS = [
  '1_to_3_seconds',
  '250_to_1000_ms',
  'over_3_seconds',
  'under_250_ms',
  'unknown',
] as const
const METHODS = ['camera', 'pasted_qr', 'payment_key', 'uploaded_image'] as const
const OUTCOMES = [
  'approved',
  'cancelled',
  'dismissed',
  'empty',
  'error',
  'failed',
  'filtered_empty',
  'invalid',
  'pending',
  'reconnected',
  'rejected',
  'requires_more_info',
  'stale',
  'success',
  'timeout',
  'unavailable',
  'unsupported',
  'valid',
] as const
const RAILS = ['BREB', 'PIX'] as const
const SOURCE_ASSETS = ['OTHER', 'USDC', 'USDT'] as const
const SOURCE_SURFACES = ['header', 'home', 'journey', 'returning_user'] as const
const STATES = [
  'connection_lost',
  'minipay_disclosure',
  'reconnect_failed',
  'reconnecting',
  'region_unavailable',
] as const
const STATUSES = [
  'COMPLETED',
  'EXPIRED',
  'FAILED',
  'PENDING',
  'PROCESSING',
  'REFUNDED',
  'UNKNOWN',
] as const
const STEPS = [
  'about',
  'activity',
  'authorize',
  'contact_address',
  'destination',
  'document_review',
  'payment_details',
  'pay_from',
  'progress',
  'receipt',
  'review',
] as const
const TERMINAL_OUTCOMES = [
  'completed',
  'expired',
  'failed',
  'manual_review',
  'outcome_unknown',
  'refund_failed',
  'refund_pending',
  'refunded',
] as const
const TRIGGER_CATEGORIES = [
  'compliance_required',
  'document_expired',
  'information_required',
  'unknown',
] as const
const TRIGGER_LOCATIONS = ['flow', 'header', 'source_pill'] as const
const WALLET_CATEGORIES = [
  'browser',
  'minipay',
  'stellar',
  'unknown',
  'walletconnect',
] as const
const COUNT_BUCKETS = [
  'eleven_to_fifty',
  'fifty_one_to_one_hundred',
  'one',
  'over_one_hundred',
  'two_to_ten',
  'unknown',
  'zero',
] as const

export interface ConsumerUxTelemetryRequest {
  action?: typeof ACTIONS[number]
  activity_session_key?: string
  app_session_key?: string
  chain?: typeof CHAINS[number]
  checkout_attempt_key?: string
  copy_variant?: typeof COPY_VARIANTS[number]
  device_class: typeof DEVICE_CLASSES[number]
  elapsed_bucket?: typeof ELAPSED_BUCKETS[number]
  entry_surface?: typeof ENTRY_SURFACES[number]
  error_category?: typeof ERROR_CATEGORIES[number]
  event_key: string
  event_name: ConsumerUxEventName
  field_category?: typeof FIELD_CATEGORIES[number]
  filter?: typeof FILTERS[number]
  immediate_reversal?: boolean
  initial_destination?: typeof DESTINATIONS[number]
  key_type?: typeof KEY_TYPES[number]
  latency_bucket?: typeof LATENCY_BUCKETS[number]
  loaded_count_bucket?: typeof COUNT_BUCKETS[number]
  method?: typeof METHODS[number]
  outcome?: typeof OUTCOMES[number]
  rail?: typeof RAILS[number]
  reference_available?: boolean
  schema_version: 2
  selected_destination?: typeof DESTINATIONS[number]
  source_asset?: typeof SOURCE_ASSETS[number]
  source_surface?: typeof SOURCE_SURFACES[number]
  state?: typeof STATES[number]
  status?: typeof STATUSES[number]
  step?: typeof STEPS[number]
  terminal_outcome?: typeof TERMINAL_OUTCOMES[number]
  total_count_bucket?: typeof COUNT_BUCKETS[number]
  trigger_category?: typeof TRIGGER_CATEGORIES[number]
  trigger_location?: typeof TRIGGER_LOCATIONS[number]
  ui_version: string
  verification_session_key?: string
  wallet_category?: typeof WALLET_CATEGORIES[number]
}

export interface ConsumerUxTelemetryResponse {
  accepted: true
}

type ConsumerUxEventName = typeof EVENT_NAMES[number]
type ConsumerUxTelemetryField = keyof ConsumerUxTelemetryRequest

const REQUIRED_EVENT_FIELDS: Readonly<Record<
  ConsumerUxEventName,
  readonly ConsumerUxTelemetryField[]
>> = {
  activity_detail_restored: ['entry_surface', 'latency_bucket', 'outcome'],
  activity_filter_changed: ['action', 'filter'],
  activity_opened: ['entry_surface'],
  activity_page_outcome: ['latency_bucket', 'outcome'],
  activity_reference_action: ['action', 'reference_available'],
  activity_retry: ['action'],
  activity_row_opened: ['rail', 'status'],
  conditional_service_action: ['action', 'outcome', 'state'],
  conditional_service_state_viewed: ['state'],
  destination_control_viewed: ['initial_destination', 'source_surface', 'step'],
  destination_selected: [
    'immediate_reversal',
    'initial_destination',
    'selected_destination',
    'source_surface',
  ],
  file_picker_opened: ['method', 'rail', 'step'],
  header_action_clicked: ['action', 'immediate_reversal', 'source_surface'],
  help_opened: ['copy_variant', 'elapsed_bucket', 'status'],
  history_opened_from_receipt: ['action', 'rail', 'reference_available'],
  processing_delay_bucket_crossed: ['copy_variant', 'elapsed_bucket', 'status'],
  processing_exit: ['action', 'elapsed_bucket', 'status'],
  processing_state_viewed: ['copy_variant', 'status'],
  qr_decode_outcome: ['elapsed_bucket', 'method', 'outcome', 'rail'],
  qr_mode_impression: ['method', 'rail'],
  qr_mode_selected: ['method', 'rail'],
  receipt_downloaded: ['action', 'outcome', 'rail', 'reference_available'],
  receipt_reference_copied: ['action', 'outcome', 'rail', 'reference_available'],
  receipt_shared: ['action', 'outcome', 'rail', 'reference_available'],
  receipt_viewed: ['outcome', 'rail', 'reference_available', 'status'],
  recipient_correction: ['key_type', 'method', 'rail'],
  recipient_entry_abandoned: ['elapsed_bucket', 'method', 'outcome', 'rail'],
  recipient_help_opened: ['key_type', 'method', 'rail'],
  recipient_input_started: ['key_type', 'method', 'rail'],
  recipient_method_impression: ['method', 'rail', 'step'],
  recipient_method_selected: ['method', 'rail', 'step'],
  recipient_method_switched: ['method', 'rail', 'step'],
  recipient_validation_outcome: ['key_type', 'method', 'outcome', 'rail'],
  support_opened_from_receipt: ['action', 'rail', 'reference_available'],
  verification_cancelled: ['elapsed_bucket', 'outcome', 'step', 'trigger_category'],
  verification_resumed: ['elapsed_bucket', 'outcome', 'step', 'trigger_category'],
  verification_step_viewed: ['elapsed_bucket', 'step', 'trigger_category'],
  verification_submit_outcome: ['elapsed_bucket', 'outcome', 'step', 'trigger_category'],
  verification_validation_outcome: ['elapsed_bucket', 'outcome', 'step', 'trigger_category'],
  verification_viewed: ['elapsed_bucket', 'step', 'trigger_category'],
  wallet_chain_selected: ['chain', 'source_asset', 'trigger_location'],
  wallet_connect_outcome: ['outcome', 'trigger_location', 'wallet_category'],
  wallet_cta_clicked: ['source_surface', 'trigger_location'],
  wallet_cta_impression: ['source_surface', 'trigger_location'],
  wallet_option_selected: ['chain', 'source_asset', 'trigger_location', 'wallet_category'],
  wallet_selector_closed: ['outcome', 'trigger_location'],
  wallet_selector_opened: ['source_surface', 'trigger_location'],
}

const activityEvents = new Set<ConsumerUxEventName>([
  'activity_detail_restored',
  'activity_filter_changed',
  'activity_opened',
  'activity_page_outcome',
  'activity_reference_action',
  'activity_retry',
  'activity_row_opened',
])
const appEvents = new Set<ConsumerUxEventName>([
  'conditional_service_action',
  'conditional_service_state_viewed',
])
const verificationEvents = new Set<ConsumerUxEventName>([
  'verification_cancelled',
  'verification_resumed',
  'verification_step_viewed',
  'verification_submit_outcome',
  'verification_validation_outcome',
  'verification_viewed',
])

const schema = z.object({
  action: z.enum(ACTIONS).optional(),
  activity_session_key: z.string().uuid().optional(),
  app_session_key: z.string().uuid().optional(),
  chain: z.enum(CHAINS).optional(),
  checkout_attempt_key: z.string().uuid().optional(),
  copy_variant: z.enum(COPY_VARIANTS).optional(),
  device_class: z.enum(DEVICE_CLASSES),
  elapsed_bucket: z.enum(ELAPSED_BUCKETS).optional(),
  entry_surface: z.enum(ENTRY_SURFACES).optional(),
  error_category: z.enum(ERROR_CATEGORIES).optional(),
  event_key: z.string().uuid(),
  event_name: z.enum(EVENT_NAMES),
  field_category: z.enum(FIELD_CATEGORIES).optional(),
  filter: z.enum(FILTERS).optional(),
  immediate_reversal: z.boolean().optional(),
  initial_destination: z.enum(DESTINATIONS).optional(),
  key_type: z.enum(KEY_TYPES).optional(),
  latency_bucket: z.enum(LATENCY_BUCKETS).optional(),
  loaded_count_bucket: z.enum(COUNT_BUCKETS).optional(),
  method: z.enum(METHODS).optional(),
  outcome: z.enum(OUTCOMES).optional(),
  rail: z.enum(RAILS).optional(),
  reference_available: z.boolean().optional(),
  schema_version: z.literal(2),
  selected_destination: z.enum(DESTINATIONS).optional(),
  source_asset: z.enum(SOURCE_ASSETS).optional(),
  source_surface: z.enum(SOURCE_SURFACES).optional(),
  state: z.enum(STATES).optional(),
  status: z.enum(STATUSES).optional(),
  step: z.enum(STEPS).optional(),
  terminal_outcome: z.enum(TERMINAL_OUTCOMES).optional(),
  total_count_bucket: z.enum(COUNT_BUCKETS).optional(),
  trigger_category: z.enum(TRIGGER_CATEGORIES).optional(),
  trigger_location: z.enum(TRIGGER_LOCATIONS).optional(),
  ui_version: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  verification_session_key: z.string().uuid().optional(),
  wallet_category: z.enum(WALLET_CATEGORIES).optional(),
}).strict().superRefine((event, context) => {
  const expectedKey = activityEvents.has(event.event_name)
    ? 'activity_session_key'
    : verificationEvents.has(event.event_name)
      ? 'verification_session_key'
      : appEvents.has(event.event_name)
        ? 'app_session_key'
        : 'checkout_attempt_key'
  const suppliedKeys = [
    event.activity_session_key,
    event.app_session_key,
    event.checkout_attempt_key,
    event.verification_session_key,
  ].filter(Boolean)

  if (!event[expectedKey] || suppliedKeys.length !== 1) {
    context.addIssue({
      code: 'custom',
      message: `Exactly one ${expectedKey} is required for ${event.event_name}`,
      path: [expectedKey],
    })
  }

  REQUIRED_EVENT_FIELDS[event.event_name].forEach((field) => {
    if (event[field] !== undefined) return
    context.addIssue({
      code: 'custom',
      message: `${field} is required for ${event.event_name}`,
      path: [field],
    })
  })
})

export const parseConsumerUxTelemetry = (
  value: unknown,
): z.ZodSafeParseResult<ConsumerUxTelemetryRequest> => schema.safeParse(value)
