import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowPricingProvider,
  FlowStepCompletionPolicy,
  FlowStepType,
  TargetCurrency,
} from '@prisma/client'
import { z } from 'zod'

const configSchema = z.record(z.string().min(1), z.unknown())
const signalMatchSchema = z.record(z.string().min(1), z.unknown())

export type FlowStepDefinitionInput = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  signalMatch?: Record<string, unknown>
  stepOrder: number
  stepType: FlowStepType
}

export type FlowDefinitionInput = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  enabled?: boolean
  exchangeFeePct?: number
  fixedFee?: number
  maxAmount?: number
  minAmount?: number
  name: string
  pricingProvider: FlowPricingProvider
  steps: FlowStepDefinitionInput[]
  targetCurrency: TargetCurrency
}

export const flowStepDefinitionSchema: z.ZodType<FlowStepDefinitionInput> = z.object({
  completionPolicy: z.nativeEnum(FlowStepCompletionPolicy),
  config: configSchema,
  signalMatch: signalMatchSchema.optional(),
  stepOrder: z.number().int().positive(),
  stepType: z.nativeEnum(FlowStepType),
})

export const flowDefinitionSchema: z.ZodType<FlowDefinitionInput> = z.object({
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  enabled: z.boolean().optional(),
  exchangeFeePct: z.number().min(0).optional(),
  fixedFee: z.number().min(0).optional(),
  maxAmount: z.number().min(0).optional(),
  minAmount: z.number().min(0).optional(),
  name: z.string().min(1),
  pricingProvider: z.nativeEnum(FlowPricingProvider),
  steps: z.array(flowStepDefinitionSchema).min(1),
  targetCurrency: z.nativeEnum(TargetCurrency),
})

export type FlowStepDefinitionDto = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  createdAt: Date
  flowDefinitionId: string
  id: string
  signalMatch?: Record<string, unknown> | null
  stepOrder: number
  stepType: FlowStepType
  updatedAt: Date
}

export type FlowDefinitionDto = {
  blockchain: BlockchainNetwork
  createdAt: Date
  cryptoCurrency: CryptoCurrency
  enabled: boolean
  exchangeFeePct: number
  fixedFee: number
  id: string
  maxAmount: number | null
  minAmount: number | null
  name: string
  pricingProvider: FlowPricingProvider
  steps: FlowStepDefinitionDto[]
  targetCurrency: TargetCurrency
  updatedAt: Date
}

export type FlowDefinitionUpdateInput = FlowDefinitionInput
