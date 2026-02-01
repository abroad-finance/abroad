export const flowInstanceStatuses = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'WAITING',
  'FAILED',
  'COMPLETED',
] as const

export type FlowInstanceStatus = typeof flowInstanceStatuses[number]

export const flowStepStatuses = [
  'READY',
  'RUNNING',
  'WAITING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
] as const

export type FlowBusinessStep
  = | {
    asset: SupportedCurrency
    fromVenue: FlowVenue
    toVenue: FlowVenue
    type: 'TRANSFER_VENUE'
  }
  | {
    fromAsset: SupportedCurrency
    toAsset: SupportedCurrency
    type: 'CONVERT'
    venue: FlowVenue
  }
  | { type: 'MOVE_TO_EXCHANGE', venue: FlowVenue }
  | { type: 'PAYOUT' }

export type FlowCorridor = {
  blockchain: string
  cryptoCurrency: string
  definitionId?: null | string
  definitionName?: null | string
  enabled?: boolean | null
  payoutProvider?: null | PaymentMethod
  status: FlowCorridorStatus
  targetCurrency: string
  unsupportedReason?: null | string
  updatedAt?: null | string
}

export type FlowCorridorListResponse = {
  corridors: FlowCorridor[]
  summary: FlowCorridorSummary
}

export type FlowCorridorStatus = 'DEFINED' | 'MISSING' | 'UNSUPPORTED'

export type FlowCorridorSummary = {
  defined: number
  missing: number
  total: number
  unsupported: number
}

export type FlowCorridorSupportStatus = 'SUPPORTED' | 'UNSUPPORTED'

export type FlowCorridorUpdateInput = {
  blockchain: string
  cryptoCurrency: string
  reason?: string
  status: FlowCorridorSupportStatus
  targetCurrency: string
}

export type FlowDefinition = {
  blockchain: string
  createdAt: string
  cryptoCurrency: string
  enabled: boolean
  exchangeFeePct: number
  fixedFee: number
  id: string
  maxAmount: null | number
  minAmount: null | number
  name: string
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  steps: FlowBusinessStep[]
  targetCurrency: string
  updatedAt: string
}

export type FlowDefinitionInput = {
  blockchain: string
  cryptoCurrency: string
  enabled?: boolean
  exchangeFeePct?: number
  fixedFee?: number
  maxAmount?: null | number
  minAmount?: null | number
  name: string
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  steps: FlowBusinessStep[]
  targetCurrency: string
}

export type FlowInstanceCurrentStep = {
  status: FlowStepStatus
  stepOrder: number
  stepType: FlowStepType
}

export type FlowInstanceDetail = {
  createdAt: string
  currentStepOrder: null | number
  definition: FlowSnapshotDefinition | null
  flowSnapshot: FlowSnapshot | null
  id: string
  signals: FlowSignal[]
  status: FlowInstanceStatus
  steps: FlowStepInstance[]
  transaction: FlowTransactionDetail | null
  transactionId: string
  updatedAt: string
}

export type FlowInstanceListResponse = {
  items: FlowInstanceSummary[]
  page: number
  pageSize: number
  total: number
}

export type FlowInstanceSummary = {
  createdAt: string
  currentStep: FlowInstanceCurrentStep | null
  currentStepOrder: null | number
  definition: FlowSnapshotDefinition | null
  id: string
  status: FlowInstanceStatus
  stepSummary: FlowStepSummary
  transaction: FlowTransactionSummary | null
  transactionId: string
  updatedAt: string
}

export type FlowPricingProvider = 'BINANCE' | 'TRANSFERO'

export type FlowSignal = {
  consumedAt: null | string
  correlationKeys: Record<string, unknown>
  createdAt: string
  eventType: string
  id: string
  payload: Record<string, unknown>
  stepInstanceId: null | string
}

export type FlowSnapshot = {
  definition: FlowSnapshotDefinition
  steps: FlowSnapshotStep[]
}

export type FlowSnapshotDefinition = {
  blockchain: string
  cryptoCurrency: string
  exchangeFeePct: number
  fixedFee: number
  id: string
  maxAmount: null | number
  minAmount: null | number
  name: string
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  targetCurrency: string
}

export type FlowSnapshotStep = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  signalMatch?: null | Record<string, unknown>
  stepOrder: number
  stepType: FlowStepType
}

export type FlowStepCompletionPolicy = 'AWAIT_EVENT' | 'SYNC'

export type FlowStepInstance = {
  attempts: number
  correlation: null | Record<string, unknown>
  createdAt: string
  endedAt: null | string
  error: null | Record<string, unknown>
  flowInstanceId: string
  id: string
  input: null | Record<string, unknown>
  maxAttempts: number
  output: null | Record<string, unknown>
  startedAt: null | string
  status: FlowStepStatus
  stepOrder: number
  stepType: FlowStepType
  updatedAt: string
}

export type FlowStepStatus = typeof flowStepStatuses[number]

export type FlowStepSummary = {
  failed: number
  ready: number
  running: number
  skipped: number
  succeeded: number
  total: number
  waiting: number
}

export type FlowStepType
  = | 'AWAIT_EXCHANGE_BALANCE'
    | 'AWAIT_PROVIDER_STATUS'
    | 'EXCHANGE_CONVERT'
    | 'EXCHANGE_SEND'
    | 'PAYOUT_SEND'
    | 'TREASURY_TRANSFER'

export type FlowTransactionDetail = {
  accountNumber: string
  bankCode: string
  createdAt: string
  externalId: null | string
  id: string
  onChainId: null | string
  paymentMethod: string
  quote: {
    cryptoCurrency: string
    network: string
    sourceAmount: number
    targetAmount: number
    targetCurrency: string
  }
  refundOnChainId: null | string
  status: string
  taxId: null | string
}

export type FlowTransactionSummary = {
  externalId: null | string
  id: string
  onChainId: null | string
  refundOnChainId: null | string
  status: string
}

export type FlowVenue = 'BINANCE' | 'TRANSFERO'

export type PaymentMethod = 'BREB' | 'PIX'

export type SupportedCurrency = 'BRL' | 'COP' | 'USDC' | 'USDT'
