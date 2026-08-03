import { FlowStepType, TargetCurrency } from '@prisma/client'
import { z } from 'zod'

const decimalStringSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)

export const businessPerformanceFlowSnapshotSchema = z.object({
  steps: z.array(z.object({
    config: z.record(z.string(), z.unknown()),
    stepOrder: z.number().int().positive(),
    stepType: z.nativeEnum(FlowStepType),
  })),
}).loose()

export const businessPerformanceNetworkFeeOutputSchema = z.object({
  networkFee: z.object({
    amount: decimalStringSchema,
    currency: z.string().trim().min(1).max(16),
  }).nullable().optional(),
  transactionId: z.string().trim().min(1).nullable().optional(),
}).loose()

export const businessPerformancePayoutOutputSchema = z.object({
  economics: z.object({
    feeCurrency: z.nativeEnum(TargetCurrency),
    feeNative: decimalStringSchema,
    netAmountNative: decimalStringSchema,
  }).optional(),
  externalId: z.string().uuid().optional(),
  provider: z.string().min(1),
}).loose()

export const businessPerformanceSettlementOutputSchema = z.object({
  amount: z.number().finite().positive(),
  provider: z.literal('transfero'),
  reconciliation: z.object({
    economics: z.object({
      lockedRateNativePerUsd: decimalStringSchema,
      payoutCurrency: z.nativeEnum(TargetCurrency),
      providerProceedsNative: decimalStringSchema,
    }).optional(),
    providerOperationId: z.string().uuid(),
    settledSourceAmount: decimalStringSchema,
  }).optional(),
}).loose()
