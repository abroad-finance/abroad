import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowPricingProvider,
  FlowStepCompletionPolicy,
  FlowStepType,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'

export type FlowSnapshotStep = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  signalMatch?: Record<string, unknown> | null
  stepOrder: number
  stepType: FlowStepType
}

export type FlowSnapshot = {
  definition: {
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
    exchangeFeePct: number
    fixedFee: number
    id: string
    maxAmount: number | null
    minAmount: number | null
    name: string
    pricingProvider: FlowPricingProvider
    targetCurrency: TargetCurrency
  }
  steps: FlowSnapshotStep[]
}

export type FlowContext = {
  accountNumber: string
  bankCode: string
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  externalId: string | null
  onChainId: string | null
  partnerId: string
  partnerUserId: string
  paymentMethod: PaymentMethod
  qrCode: string | null
  quoteId: string
  sourceAmount: number
  targetAmount: number
  targetCurrency: TargetCurrency
  taxId: string | null
  transactionId: string
}

export type CorrelationKeys = Record<string, boolean | number | string>

export type FlowStepExecutionResult =
  | {
    correlation?: CorrelationKeys
    output?: Record<string, unknown>
    outcome: 'succeeded'
  }
  | {
    correlation: CorrelationKeys
    output?: Record<string, unknown>
    outcome: 'waiting'
  }
  | {
    correlation?: CorrelationKeys
    error: string
    output?: Record<string, unknown>
    outcome: 'failed'
  }

export type FlowStepSignalResult = FlowStepExecutionResult

export type FlowSignalInput = {
  correlationKeys: CorrelationKeys
  eventType: string
  payload: Record<string, unknown>
  transactionId?: string
}

export type FlowStepRuntimeContext = {
  context: FlowContext
  stepOutputs: Map<number, Record<string, unknown>>
}

export interface FlowStepExecutor {
  readonly stepType: FlowStepType
  execute(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult>

  handleSignal?: (params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    signal: FlowSignalInput
    stepOrder: number
  }) => Promise<FlowStepSignalResult>
}
