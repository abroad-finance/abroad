import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowPricingProvider,
  FlowStepCompletionPolicy,
  FlowStepType,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'

export type CorrelationKeys = Record<string, boolean | number | string>

export type FlowContext = {
  accountNumber: string
  bankCode: string
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  externalId: null | string
  onChainId: null | string
  partnerId: string
  partnerUserId: string
  paymentMethod: PaymentMethod
  qrCode: null | string
  quoteId: string
  sourceAmount: number
  targetAmount: number
  targetCurrency: TargetCurrency
  taxId: null | string
  transactionId: string
}

export type FlowSignalInput = {
  correlationKeys: CorrelationKeys
  eventType: string
  payload: Record<string, unknown>
  transactionId?: string
}

export type FlowSnapshot = {
  definition: {
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
    exchangeFeePct: number
    fixedFee: number
    id: string
    maxAmount: null | number
    minAmount: null | number
    name: string
    payoutProvider: PaymentMethod
    pricingProvider: FlowPricingProvider
    targetCurrency: TargetCurrency
  }
  steps: FlowSnapshotStep[]
}

export type FlowSnapshotStep = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  signalMatch?: null | Record<string, unknown>
  stepOrder: number
  stepType: FlowStepType
}

export type FlowStepExecutionResult
  = | {
    correlation: CorrelationKeys
    outcome: 'waiting'
    output?: Record<string, unknown>
  }
  | {
    correlation?: CorrelationKeys
    error: string
    outcome: 'failed'
    output?: Record<string, unknown>
  }
  | {
    correlation?: CorrelationKeys
    outcome: 'succeeded'
    output?: Record<string, unknown>
  }

export interface FlowStepExecutor {
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

  readonly stepType: FlowStepType
}

export type FlowStepRuntimeContext = {
  context: FlowContext
  stepOutputs: Map<number, Record<string, unknown>>
}

export type FlowStepSignalResult = FlowStepExecutionResult
