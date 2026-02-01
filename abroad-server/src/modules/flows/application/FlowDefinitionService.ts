import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import {
  FlowBusinessStep,
  FlowDefinitionDto,
  FlowDefinitionInput,
  FlowDefinitionUpdateInput,
  flowBusinessStepSchema,
} from './flowDefinitionSchemas'
import { FlowDefinitionBuilder, FlowDefinitionBuilderError } from './FlowDefinitionBuilder'

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
    @inject(FlowDefinitionBuilder)
    private readonly builder: FlowDefinitionBuilder,
  ) {}

  public async list(): Promise<FlowDefinitionDto[]> {
    const client = await this.dbProvider.getClient()
    const definitions = await client.flowDefinition.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return definitions.map(definition => this.toDto(definition))
  }

  public async create(payload: FlowDefinitionInput): Promise<FlowDefinitionDto> {
    const client = await this.dbProvider.getClient()

    try {
      const steps = this.buildSystemSteps(payload)
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
          payoutProvider: payload.payoutProvider,
          pricingProvider: payload.pricingProvider,
          steps: {
            create: steps.map(step => this.toStepCreate(step)),
          },
          targetCurrency: payload.targetCurrency,
          userSteps: this.normalizeJson(payload.steps),
        },
      })

      return this.toDto(created)
    }
    catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new FlowDefinitionValidationError('A flow already exists for this corridor')
      }
      if (error instanceof FlowDefinitionBuilderError) {
        throw new FlowDefinitionValidationError(error.message)
      }
      throw error
    }
  }

  public async update(flowId: string, payload: FlowDefinitionUpdateInput): Promise<FlowDefinitionDto> {
    const client = await this.dbProvider.getClient()

    try {
      const steps = this.buildSystemSteps(payload)
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
            payoutProvider: payload.payoutProvider,
            pricingProvider: payload.pricingProvider,
            steps: {
              create: steps.map(step => this.toStepCreate(step)),
            },
            targetCurrency: payload.targetCurrency,
            userSteps: this.normalizeJson(payload.steps),
          },
          where: { id: flowId },
        })
      })

      return this.toDto(updated)
    }
    catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new FlowDefinitionValidationError('A flow already exists for this corridor')
      }
      if (error instanceof FlowDefinitionBuilderError) {
        throw new FlowDefinitionValidationError(error.message)
      }
      throw error
    }
  }

  private toStepCreate(step: ReturnType<FlowDefinitionBuilder['build']>[number]): Prisma.FlowStepDefinitionCreateWithoutFlowDefinitionInput {
    return {
      completionPolicy: step.completionPolicy,
      config: this.normalizeJson(step.config),
      signalMatch: step.signalMatch ? this.normalizeJson(step.signalMatch) : undefined,
      stepOrder: step.stepOrder,
      stepType: step.stepType,
    }
  }

  private normalizeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
  }

  private toDto(definition: {
    id: string
    name: string
    enabled: boolean
    cryptoCurrency: FlowDefinitionDto['cryptoCurrency']
    blockchain: FlowDefinitionDto['blockchain']
    targetCurrency: FlowDefinitionDto['targetCurrency']
    payoutProvider: FlowDefinitionDto['payoutProvider']
    pricingProvider: FlowDefinitionDto['pricingProvider']
    exchangeFeePct: number
    fixedFee: number
    minAmount: number | null
    maxAmount: number | null
    userSteps: Prisma.JsonValue
    createdAt: Date
    updatedAt: Date
  }): FlowDefinitionDto {
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
      payoutProvider: definition.payoutProvider,
      pricingProvider: definition.pricingProvider,
      steps: this.parseUserSteps(definition.userSteps),
      targetCurrency: definition.targetCurrency,
      updatedAt: definition.updatedAt,
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private parseUserSteps(value: Prisma.JsonValue): FlowBusinessStep[] {
    const parsed = z.array(flowBusinessStepSchema).safeParse(value)
    if (parsed.success) {
      return parsed.data
    }
    return []
  }

  private buildSystemSteps(payload: FlowDefinitionInput): ReturnType<FlowDefinitionBuilder['build']> {
    return this.builder.build(payload)
  }
}
