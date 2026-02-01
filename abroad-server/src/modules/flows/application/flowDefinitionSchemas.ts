import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  FlowPricingProvider,
  FlowStepCompletionPolicy,
  FlowStepType,
  PaymentMethod,
  SupportedCurrency,
  TargetCurrency,
} from '@prisma/client'
import { z } from 'zod'

const configSchema = z.record(z.string().min(1), z.unknown())
const signalMatchSchema = z.record(z.string().min(1), z.unknown())

export type FlowVenue = 'BINANCE' | 'TRANSFERO'

export type FlowBusinessStep =
  | { type: 'PAYOUT' }
  | { type: 'MOVE_TO_EXCHANGE', venue: FlowVenue }
  | {
    type: 'CONVERT'
    venue: FlowVenue
    fromAsset: SupportedCurrency
    toAsset: SupportedCurrency
  }
  | {
    type: 'TRANSFER_VENUE'
    asset: SupportedCurrency
    fromVenue: FlowVenue
    toVenue: FlowVenue
  }

const flowVenueSchema = z.enum(['BINANCE', 'TRANSFERO'])

export const flowBusinessStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PAYOUT') }),
  z.object({
    type: z.literal('MOVE_TO_EXCHANGE'),
    venue: flowVenueSchema,
  }),
  z.object({
    type: z.literal('CONVERT'),
    venue: flowVenueSchema,
    fromAsset: z.nativeEnum(SupportedCurrency),
    toAsset: z.nativeEnum(SupportedCurrency),
  }),
  z.object({
    type: z.literal('TRANSFER_VENUE'),
    asset: z.nativeEnum(SupportedCurrency),
    fromVenue: flowVenueSchema,
    toVenue: flowVenueSchema,
  }),
])

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
  maxAmount?: number | null
  minAmount?: number | null
  name: string
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  steps: FlowBusinessStep[]
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
  maxAmount: z.number().min(0).nullable().optional(),
  minAmount: z.number().min(0).nullable().optional(),
  name: z.string().min(1),
  payoutProvider: z.nativeEnum(PaymentMethod),
  pricingProvider: z.nativeEnum(FlowPricingProvider),
  steps: z.array(flowBusinessStepSchema).min(1),
  targetCurrency: z.nativeEnum(TargetCurrency),
})

export const flowSnapshotSchema = z.object({
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  exchangeFeePct: z.number().min(0),
  fixedFee: z.number().min(0),
  maxAmount: z.number().min(0).optional(),
  minAmount: z.number().min(0).optional(),
  name: z.string().min(1),
  payoutProvider: z.nativeEnum(PaymentMethod),
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
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  steps: FlowBusinessStep[]
  targetCurrency: TargetCurrency
  updatedAt: Date
}

export type FlowDefinitionUpdateInput = FlowDefinitionInput

export type FlowCorridorSummaryDto = {
  defined: number
  missing: number
  total: number
  unsupported: number
}

export type FlowCorridorDto = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  definitionId?: string | null
  definitionName?: string | null
  enabled?: boolean
  payoutProvider?: PaymentMethod | null
  status: 'DEFINED' | 'MISSING' | 'UNSUPPORTED'
  targetCurrency: TargetCurrency
  unsupportedReason?: string | null
  updatedAt?: Date | null
}

export type FlowCorridorListDto = {
  corridors: FlowCorridorDto[]
  summary: FlowCorridorSummaryDto
}

export type FlowCorridorUpdateInput = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  reason?: string
  status: FlowCorridorStatus
  targetCurrency: TargetCurrency
}

export const flowCorridorUpdateSchema: z.ZodType<FlowCorridorUpdateInput> = z.object({
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  reason: z.string().min(1).optional(),
  status: z.nativeEnum(FlowCorridorStatus),
  targetCurrency: z.nativeEnum(TargetCurrency),
})
