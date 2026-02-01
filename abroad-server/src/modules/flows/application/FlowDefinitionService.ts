import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import {
  FlowDefinitionDto,
  FlowDefinitionInput,
  FlowDefinitionUpdateInput,
  FlowStepDefinitionDto,
  FlowStepDefinitionInput,
} from './flowDefinitionSchemas'

export class FlowDefinitionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowDefinitionValidationError'
  }
}

@injectable()
export class FlowDefinitionService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async list(): Promise<FlowDefinitionDto[]> {
    const client = await this.dbProvider.getClient()
    const definitions = await client.flowDefinition.findMany({
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return definitions.map(definition => this.toDto(definition, definition.steps))
  }

  public async create(payload: FlowDefinitionInput): Promise<FlowDefinitionDto> {
    const steps = this.normalizeSteps(payload.steps)
    this.ensureStepOrderIsContiguous(steps)

    const client = await this.dbProvider.getClient()

    try {
      const created = await client.flowDefinition.create({
        data: {
          blockchain: payload.blockchain,
          cryptoCurrency: payload.cryptoCurrency,
          enabled: payload.enabled ?? true,
          exchangeFeePct: payload.exchangeFeePct ?? 0,
          fixedFee: payload.fixedFee ?? 0,
          maxAmount: payload.maxAmount ?? null,
          minAmount: payload.minAmount ?? null,
          name: payload.name.trim(),
          pricingProvider: payload.pricingProvider,
          steps: {
            create: steps.map(step => this.toStepCreate(step)),
          },
          targetCurrency: payload.targetCurrency,
        },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      })

      return this.toDto(created, created.steps)
    }
    catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new FlowDefinitionValidationError('A flow already exists for this corridor')
      }
      throw error
    }
  }

  public async update(flowId: string, payload: FlowDefinitionUpdateInput): Promise<FlowDefinitionDto> {
    const steps = this.normalizeSteps(payload.steps)
    this.ensureStepOrderIsContiguous(steps)

    const client = await this.dbProvider.getClient()

    try {
      const updated = await client.$transaction(async (tx) => {
        await tx.flowStepDefinition.deleteMany({ where: { flowDefinitionId: flowId } })
        return tx.flowDefinition.update({
          data: {
            blockchain: payload.blockchain,
            cryptoCurrency: payload.cryptoCurrency,
            enabled: payload.enabled ?? true,
            exchangeFeePct: payload.exchangeFeePct ?? 0,
            fixedFee: payload.fixedFee ?? 0,
            maxAmount: payload.maxAmount ?? null,
            minAmount: payload.minAmount ?? null,
            name: payload.name.trim(),
            pricingProvider: payload.pricingProvider,
            steps: {
              create: steps.map(step => this.toStepCreate(step)),
            },
            targetCurrency: payload.targetCurrency,
          },
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
          where: { id: flowId },
        })
      })

      return this.toDto(updated, updated.steps)
    }
    catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new FlowDefinitionValidationError('A flow already exists for this corridor')
      }
      throw error
    }
  }

  private normalizeSteps(steps: FlowStepDefinitionInput[]): FlowStepDefinitionInput[] {
    return [...steps].sort((a, b) => a.stepOrder - b.stepOrder)
  }

  private ensureStepOrderIsContiguous(steps: FlowStepDefinitionInput[]): void {
    if (steps.length === 0) {
      throw new FlowDefinitionValidationError('At least one step is required')
    }

    const orders = steps.map(step => step.stepOrder)
    const uniqueOrders = new Set(orders)
    if (uniqueOrders.size !== orders.length) {
      throw new FlowDefinitionValidationError('Step order values must be unique')
    }

    const sorted = [...uniqueOrders].sort((a, b) => a - b)
    const expectedStart = 1
    if (sorted[0] !== expectedStart) {
      throw new FlowDefinitionValidationError('Step order must start at 1')
    }

    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] !== sorted[index - 1] + 1) {
        throw new FlowDefinitionValidationError('Step order must be contiguous without gaps')
      }
    }
  }

  private toStepCreate(step: FlowStepDefinitionInput): Prisma.FlowStepDefinitionCreateWithoutFlowDefinitionInput {
    return {
      completionPolicy: step.completionPolicy,
      config: this.normalizeJson(step.config),
      signalMatch: step.signalMatch ? this.normalizeJson(step.signalMatch) : undefined,
      stepOrder: step.stepOrder,
      stepType: step.stepType,
    }
  }

  private normalizeJson(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
  }

  private toDto(
    definition: {
      id: string
      name: string
      enabled: boolean
      cryptoCurrency: FlowDefinitionDto['cryptoCurrency']
      blockchain: FlowDefinitionDto['blockchain']
      targetCurrency: FlowDefinitionDto['targetCurrency']
      pricingProvider: FlowDefinitionDto['pricingProvider']
      exchangeFeePct: number
      fixedFee: number
      minAmount: number | null
      maxAmount: number | null
      createdAt: Date
      updatedAt: Date
    },
    steps: Array<{
      id: string
      flowDefinitionId: string
      stepOrder: number
      stepType: FlowStepDefinitionDto['stepType']
      completionPolicy: FlowStepDefinitionDto['completionPolicy']
      config: Prisma.JsonValue
      signalMatch: Prisma.JsonValue | null
      createdAt: Date
      updatedAt: Date
    }>,
  ): FlowDefinitionDto {
    return {
      blockchain: definition.blockchain,
      createdAt: definition.createdAt,
      cryptoCurrency: definition.cryptoCurrency,
      enabled: definition.enabled,
      exchangeFeePct: definition.exchangeFeePct,
      fixedFee: definition.fixedFee,
      id: definition.id,
      maxAmount: definition.maxAmount,
      minAmount: definition.minAmount,
      name: definition.name,
      pricingProvider: definition.pricingProvider,
      steps: steps.map(step => this.toStepDto(step)),
      targetCurrency: definition.targetCurrency,
      updatedAt: definition.updatedAt,
    }
  }

  private toStepDto(step: {
    id: string
    flowDefinitionId: string
    stepOrder: number
    stepType: FlowStepDefinitionDto['stepType']
    completionPolicy: FlowStepDefinitionDto['completionPolicy']
    config: Prisma.JsonValue
    signalMatch: Prisma.JsonValue | null
    createdAt: Date
    updatedAt: Date
  }): FlowStepDefinitionDto {
    return {
      completionPolicy: step.completionPolicy,
      config: this.jsonToRecord(step.config),
      createdAt: step.createdAt,
      flowDefinitionId: step.flowDefinitionId,
      id: step.id,
      signalMatch: step.signalMatch ? this.jsonToRecord(step.signalMatch) : null,
      stepOrder: step.stepOrder,
      stepType: step.stepType,
      updatedAt: step.updatedAt,
    }
  }

  private jsonToRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return { value }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }
}
