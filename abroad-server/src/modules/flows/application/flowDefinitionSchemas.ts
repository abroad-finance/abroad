import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  FlowDirection,
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

export type FlowVenue = 'BINANCE' | 'TRANSFERO'

const flowVenueSchema = z.enum(['BINANCE', 'TRANSFERO'])

export const flowBusinessStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PAYOUT') }),
  z.object({
    type: z.literal('MOVE_TO_EXCHANGE'),
    venue: flowVenueSchema,
  }),
  z.object({
    fromAsset: z.nativeEnum(SupportedCurrency),
    toAsset: z.nativeEnum(SupportedCurrency),
    type: z.literal('CONVERT'),
    venue: flowVenueSchema,
  }),
  z.object({
    asset: z.nativeEnum(SupportedCurrency),
    fromVenue: flowVenueSchema,
    toVenue: flowVenueSchema,
    type: z.literal('TRANSFER_VENUE'),
  }),
])

export type FlowDefinitionInput = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  // Omitted by callers that predate the onramp; a corridor without an explicit
  // direction is the crypto-to-fiat payout this platform started with.
  direction?: FlowDirection
  enabled?: boolean
  exchangeFeePct?: number
  fixedFee?: number
  maxAmount?: null | number
  minAmount?: null | number
  name: string
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  steps: FlowBusinessStep[]
  targetCurrency: TargetCurrency
}

type FlowStepDefinitionInput = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  signalMatch?: Record<string, unknown>
  stepOrder: number
  stepType: FlowStepType
}

const flowStepDefinitionSchema: z.ZodType<FlowStepDefinitionInput> = z.object({
  completionPolicy: z.nativeEnum(FlowStepCompletionPolicy),
  config: configSchema,
  signalMatch: signalMatchSchema.optional(),
  stepOrder: z.number().int().positive(),
  stepType: z.nativeEnum(FlowStepType),
})

export const flowDefinitionSchema: z.ZodType<FlowDefinitionInput> = z.object({
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  direction: z.nativeEnum(FlowDirection).optional(),
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
  // Snapshots taken before the onramp shipped carry no direction; they are all
  // crypto-to-fiat, so the running flow keeps executing as it was defined.
  direction: z.nativeEnum(FlowDirection).default(FlowDirection.CRYPTO_TO_FIAT),
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

export type FlowCorridorDto = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  definitionId?: null | string
  definitionName?: null | string
  direction: FlowDirection
  enabled?: boolean
  payoutProvider?: null | PaymentMethod
  status: 'DEFINED' | 'MISSING' | 'UNSUPPORTED'
  targetCurrency: TargetCurrency
  unsupportedReason?: null | string
  updatedAt?: Date | null
  version: number
}

export type FlowCorridorListDto = {
  corridors: FlowCorridorDto[]
  summary: FlowCorridorSummaryDto
}

export type FlowCorridorUpdateInput = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  direction?: FlowDirection
  reason?: string
  status: FlowCorridorStatus
  targetCurrency: TargetCurrency
}

export type FlowDefinitionDto = {
  blockchain: BlockchainNetwork
  createdAt: Date
  cryptoCurrency: CryptoCurrency
  direction: FlowDirection
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
  targetCurrency: TargetCurrency
  updatedAt: Date
  version: number
}

export type FlowDefinitionUpdateInput = FlowDefinitionInput

type FlowCorridorSummaryDto = {
  defined: number
  missing: number
  total: number
  unsupported: number
}

export const flowCorridorUpdateSchema: z.ZodType<FlowCorridorUpdateInput> = z.object({
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  direction: z.nativeEnum(FlowDirection).optional(),
  reason: z.string().min(1).optional(),
  status: z.nativeEnum(FlowCorridorStatus),
  targetCurrency: z.nativeEnum(TargetCurrency),
})
