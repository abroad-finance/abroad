import { FlowStepStatus, FlowStepType, Prisma, TransactionEconomicCostStatus } from '@prisma/client'

import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

export const businessPerformanceCandidateSelect = {
  createdAt: true,
  economics: {
    select: {
      conversionStatus: true,
      lastReconciledAt: true,
      lockedRateNativePerUsd: true,
      proceedsCoverage: true,
      providerOperationId: true,
      providerProceedsNative: true,
    },
  },
  externalId: true,
  id: true,
  quote: {
    select: {
      cryptoCurrency: true,
      network: true,
      paymentMethod: true,
      sourceAmount: true,
      targetAmount: true,
      targetCurrency: true,
    },
  },
  refundOnChainId: true,
  status: true,
  transitions: {
    orderBy: { createdAt: 'desc' as const },
    select: { createdAt: true },
    take: 1,
    where: { event: 'refund' },
  },
} satisfies Prisma.TransactionSelect

export type BusinessPerformanceCandidate = Prisma.TransactionGetPayload<{
  select: typeof businessPerformanceCandidateSelect
}>

export type BusinessPerformanceClient = Awaited<ReturnType<IDatabaseClientProvider['getClient']>>

export type BusinessPerformanceCostWrite = {
  nativeAmount?: Prisma.Decimal
  nativeCurrency?: string
  observedAt?: Date
  reasonCode?: string
  status: TransactionEconomicCostStatus
  usdAmount?: Prisma.Decimal
  usdRate?: Prisma.Decimal
}

export type BusinessPerformanceFlowStep = {
  endedAt: Date | null
  output: null | Prisma.JsonValue
  status: FlowStepStatus
  stepOrder: number
  stepType: FlowStepType
}

export const toBusinessPerformanceDecimal = (
  value: number | string,
): Prisma.Decimal => new Prisma.Decimal(String(value))
