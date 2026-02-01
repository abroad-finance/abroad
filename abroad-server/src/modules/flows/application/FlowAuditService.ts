import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowInstanceStatus,
  FlowPricingProvider,
  FlowStepStatus,
  FlowStepType,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { FlowOrchestrator } from './FlowOrchestrator'
import { FlowSnapshot } from './flowTypes'

export type FlowSnapshotDefinitionDto = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  exchangeFeePct: number
  fixedFee: number
  id: string
  maxAmount: number | null
  minAmount: number | null
  name: string
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  targetCurrency: TargetCurrency
}

export type FlowStepSummaryDto = {
  failed: number
  ready: number
  running: number
  skipped: number
  succeeded: number
  total: number
  waiting: number
}

export type FlowInstanceCurrentStepDto = {
  status: FlowStepStatus
  stepOrder: number
  stepType: FlowStepType
}

export type FlowInstanceSummaryDto = {
  createdAt: Date
  currentStep: FlowInstanceCurrentStepDto | null
  currentStepOrder: number | null
  definition: FlowSnapshotDefinitionDto | null
  id: string
  status: FlowInstanceStatus
  stepSummary: FlowStepSummaryDto
  transaction: FlowTransactionSummaryDto | null
  transactionId: string
  updatedAt: Date
}

export type FlowInstanceListResponse = {
  items: FlowInstanceSummaryDto[]
  page: number
  pageSize: number
  total: number
}

export type FlowStepInstanceDto = {
  attempts: number
  correlation: Record<string, unknown> | null
  createdAt: Date
  endedAt: Date | null
  error: Record<string, unknown> | null
  flowInstanceId: string
  id: string
  input: Record<string, unknown> | null
  maxAttempts: number
  output: Record<string, unknown> | null
  startedAt: Date | null
  status: FlowStepStatus
  stepOrder: number
  stepType: FlowStepType
  updatedAt: Date
}

export type FlowSignalDto = {
  consumedAt: Date | null
  correlationKeys: Record<string, unknown>
  createdAt: Date
  eventType: string
  id: string
  payload: Record<string, unknown>
  stepInstanceId: string | null
}

export type FlowTransactionSummaryDto = {
  externalId: string | null
  id: string
  onChainId: string | null
  refundOnChainId: string | null
  status: TransactionStatus
}

export type FlowTransactionDetailDto = FlowTransactionSummaryDto & {
  accountNumber: string
  bankCode: string
  createdAt: Date
  paymentMethod: PaymentMethod
  quote: {
    cryptoCurrency: CryptoCurrency
    network: BlockchainNetwork
    sourceAmount: number
    targetAmount: number
    targetCurrency: TargetCurrency
  }
  taxId: string | null
}

export type FlowInstanceDetailDto = {
  createdAt: Date
  currentStepOrder: number | null
  definition: FlowSnapshotDefinitionDto | null
  flowSnapshot: FlowSnapshot | null
  id: string
  signals: FlowSignalDto[]
  status: FlowInstanceStatus
  steps: FlowStepInstanceDto[]
  transaction: FlowTransactionDetailDto | null
  transactionId: string
  updatedAt: Date
}

export type FlowInstanceListFilters = {
  page?: number
  pageSize?: number
  status?: FlowInstanceStatus
  stuckMinutes?: number
  transactionId?: string
}

export type FlowStepAction = 'retry' | 'requeue'

export class FlowInstanceNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowInstanceNotFoundError'
  }
}

export class FlowStepNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowStepNotFoundError'
  }
}

export class FlowStepActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowStepActionError'
  }
}

@injectable()
export class FlowAuditService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
  ) {}

  public async list(filters: FlowInstanceListFilters): Promise<FlowInstanceListResponse> {
    const page = this.normalizePage(filters.page)
    const pageSize = this.normalizePageSize(filters.pageSize)
    const where = this.buildWhere(filters)

    const client = await this.dbProvider.getClient()
    const [total, instances] = await client.$transaction([
      client.flowInstance.count({ where }),
      client.flowInstance.findMany({
        include: { steps: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
    ])

    const transactionIds = instances.map(instance => instance.transactionId)
    const transactions = await client.transaction.findMany({
      select: {
        externalId: true,
        id: true,
        onChainId: true,
        refundOnChainId: true,
        status: true,
      },
      where: { id: { in: transactionIds } },
    })
    const transactionById = new Map(transactions.map(tx => [tx.id, tx]))

    const items = instances.map(instance => {
      const definition = this.extractDefinition(instance.flowSnapshot)
      const stepSummary = this.buildStepSummary(instance.steps)
      const currentStep = this.buildCurrentStep(instance.steps, instance.currentStepOrder)
      const transaction = transactionById.get(instance.transactionId) ?? null

      return {
        createdAt: instance.createdAt,
        currentStep,
        currentStepOrder: instance.currentStepOrder,
        definition,
        id: instance.id,
        status: instance.status,
        stepSummary,
        transaction: transaction
          ? {
            externalId: transaction.externalId,
            id: transaction.id,
            onChainId: transaction.onChainId,
            refundOnChainId: transaction.refundOnChainId,
            status: transaction.status,
          }
          : null,
        transactionId: instance.transactionId,
        updatedAt: instance.updatedAt,
      }
    })

    return {
      items,
      page,
      pageSize,
      total,
    }
  }

  public async getInstance(flowInstanceId: string): Promise<FlowInstanceDetailDto> {
    const client = await this.dbProvider.getClient()
    const instance = await client.flowInstance.findUnique({
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      where: { id: flowInstanceId },
    })

    if (!instance) {
      throw new FlowInstanceNotFoundError('Flow instance not found')
    }

    const [signals, transaction] = await client.$transaction([
      client.flowSignal.findMany({
        orderBy: { createdAt: 'desc' },
        where: { flowInstanceId: instance.id },
      }),
      client.transaction.findUnique({
        include: { quote: true },
        where: { id: instance.transactionId },
      }),
    ])

    return {
      createdAt: instance.createdAt,
      currentStepOrder: instance.currentStepOrder,
      definition: this.extractDefinition(instance.flowSnapshot),
      flowSnapshot: this.extractSnapshot(instance.flowSnapshot),
      id: instance.id,
      signals: signals.map(signal => ({
        consumedAt: signal.consumedAt,
        correlationKeys: this.toRecord(signal.correlationKeys) ?? {},
        createdAt: signal.createdAt,
        eventType: signal.eventType,
        id: signal.id,
        payload: this.toRecord(signal.payload) ?? {},
        stepInstanceId: signal.stepInstanceId,
      })),
      status: instance.status,
      steps: instance.steps.map(step => ({
        attempts: step.attempts,
        correlation: this.toRecord(step.correlation),
        createdAt: step.createdAt,
        endedAt: step.endedAt,
        error: this.toRecord(step.error),
        flowInstanceId: step.flowInstanceId,
        id: step.id,
        input: this.toRecord(step.input),
        maxAttempts: step.maxAttempts,
        output: this.toRecord(step.output),
        startedAt: step.startedAt,
        status: step.status,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
        updatedAt: step.updatedAt,
      })),
      transaction: transaction
        ? {
          accountNumber: transaction.accountNumber,
          bankCode: transaction.bankCode,
          createdAt: transaction.createdAt,
          externalId: transaction.externalId,
          id: transaction.id,
          onChainId: transaction.onChainId,
          paymentMethod: transaction.quote.paymentMethod,
          quote: {
            cryptoCurrency: transaction.quote.cryptoCurrency,
            network: transaction.quote.network,
            sourceAmount: transaction.quote.sourceAmount,
            targetAmount: transaction.quote.targetAmount,
            targetCurrency: transaction.quote.targetCurrency,
          },
          refundOnChainId: transaction.refundOnChainId,
          status: transaction.status,
          taxId: transaction.taxId ?? null,
        }
        : null,
      transactionId: instance.transactionId,
      updatedAt: instance.updatedAt,
    }
  }

  public async resetStep(
    flowInstanceId: string,
    stepInstanceId: string,
    action: FlowStepAction,
  ): Promise<FlowStepInstanceDto> {
    const client = await this.dbProvider.getClient()
    const step = await client.flowStepInstance.findUnique({ where: { id: stepInstanceId } })

    if (!step || step.flowInstanceId !== flowInstanceId) {
      throw new FlowStepNotFoundError('Flow step instance not found')
    }

    const allowedStatuses: FlowStepStatus[] = action === 'retry'
      ? [FlowStepStatus.FAILED]
      : [FlowStepStatus.WAITING]

    if (!allowedStatuses.includes(step.status)) {
      throw new FlowStepActionError(`Step is not in a ${allowedStatuses.join(' or ')} state`)
    }

    const updated = await client.flowStepInstance.update({
      data: {
        correlation: Prisma.DbNull,
        endedAt: null,
        status: FlowStepStatus.READY,
        startedAt: null,
      },
      where: { id: step.id },
    })

    await client.flowInstance.update({
      data: {
        currentStepOrder: updated.stepOrder,
        status: FlowInstanceStatus.IN_PROGRESS,
      },
      where: { id: flowInstanceId },
    })

    await this.orchestrator.run(flowInstanceId)

    return {
      attempts: updated.attempts,
      correlation: this.toRecord(updated.correlation),
      createdAt: updated.createdAt,
      endedAt: updated.endedAt,
      error: this.toRecord(updated.error),
      flowInstanceId: updated.flowInstanceId,
      id: updated.id,
      input: this.toRecord(updated.input),
      maxAttempts: updated.maxAttempts,
      output: this.toRecord(updated.output),
      startedAt: updated.startedAt,
      status: updated.status,
      stepOrder: updated.stepOrder,
      stepType: updated.stepType,
      updatedAt: updated.updatedAt,
    }
  }

  private buildWhere(filters: FlowInstanceListFilters): Prisma.FlowInstanceWhereInput {
    const where: Prisma.FlowInstanceWhereInput = {}

    if (filters.transactionId) {
      where.transactionId = filters.transactionId
    }

    const stuckMinutes = this.normalizeStuckMinutes(filters.stuckMinutes)
    if (stuckMinutes) {
      const cutoff = new Date(Date.now() - stuckMinutes * 60 * 1000)
      where.status = FlowInstanceStatus.WAITING
      where.updatedAt = { lte: cutoff }
      return where
    }

    if (filters.status) {
      where.status = filters.status
    }

    return where
  }

  private buildStepSummary(steps: Array<{ status: FlowStepStatus }>): FlowStepSummaryDto {
    const summary: FlowStepSummaryDto = {
      failed: 0,
      ready: 0,
      running: 0,
      skipped: 0,
      succeeded: 0,
      total: steps.length,
      waiting: 0,
    }

    for (const step of steps) {
      switch (step.status) {
        case FlowStepStatus.READY:
          summary.ready += 1
          break
        case FlowStepStatus.RUNNING:
          summary.running += 1
          break
        case FlowStepStatus.WAITING:
          summary.waiting += 1
          break
        case FlowStepStatus.SUCCEEDED:
          summary.succeeded += 1
          break
        case FlowStepStatus.FAILED:
          summary.failed += 1
          break
        case FlowStepStatus.SKIPPED:
          summary.skipped += 1
          break
      }
    }

    return summary
  }

  private buildCurrentStep(
    steps: Array<{ status: FlowStepStatus, stepOrder: number, stepType: FlowStepType }>,
    currentStepOrder: number | null,
  ): FlowInstanceCurrentStepDto | null {
    if (currentStepOrder === null) return null
    const step = steps.find(candidate => candidate.stepOrder === currentStepOrder)
    if (!step) return null
    return {
      status: step.status,
      stepOrder: step.stepOrder,
      stepType: step.stepType,
    }
  }

  private extractDefinition(flowSnapshot: unknown): FlowSnapshotDefinitionDto | null {
    const snapshot = this.extractSnapshot(flowSnapshot)
    return snapshot?.definition ?? null
  }

  private extractSnapshot(flowSnapshot: unknown): FlowSnapshot | null {
    if (!flowSnapshot || typeof flowSnapshot !== 'object') return null
    const snapshot = flowSnapshot as FlowSnapshot
    if (!snapshot.definition || !snapshot.steps) return null
    return snapshot
  }

  private toRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (value === null || value === undefined) return null
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return { value }
  }

  private normalizePage(page?: number): number {
    if (!page || page < 1) return 1
    return Math.floor(page)
  }

  private normalizePageSize(pageSize?: number): number {
    if (!pageSize || pageSize < 1) return 25
    return Math.min(Math.floor(pageSize), 200)
  }

  private normalizeStuckMinutes(stuckMinutes?: number): number | null {
    if (!stuckMinutes || stuckMinutes <= 0) return null
    return Math.floor(stuckMinutes)
  }
}
