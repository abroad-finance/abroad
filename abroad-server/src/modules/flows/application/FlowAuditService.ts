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

export type FlowBulkRetryResult = {
  error?: string
  flowInstanceId: string
  ok: boolean
  stepInstanceId?: string
}

export type FlowFailureFilter = 'FAILED_FLOW' | 'FAILED_STEP' | 'STUCK_WAITING'

type FlowInstanceCurrentStepDto = {
  status: FlowStepStatus
  stepOrder: number
  stepType: FlowStepType
}

export type FlowInstanceDetailDto = {
  createdAt: Date
  currentStepOrder: null | number
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

type FlowInstanceListFilters = {
  blockchain?: BlockchainNetwork
  createdFrom?: string
  createdTo?: string
  cryptoCurrency?: CryptoCurrency
  failure?: FlowFailureFilter
  onChainId?: string
  page?: number
  pageSize?: number
  partnerId?: string
  payoutProvider?: PaymentMethod
  status?: FlowInstanceStatus
  stuckMinutes?: number
  targetCurrency?: TargetCurrency
  transactionId?: string
}

export type FlowInstanceListResponse = {
  items: FlowInstanceSummaryDto[]
  page: number
  pageSize: number
  statusCounts: Array<{ count: number, status: FlowInstanceStatus }>
  total: number
}

type FlowInstanceSummaryDto = {
  createdAt: Date
  currentStep: FlowInstanceCurrentStepDto | null
  currentStepOrder: null | number
  definition: FlowSnapshotDefinitionDto | null
  id: string
  status: FlowInstanceStatus
  stepSummary: FlowStepSummaryDto
  transaction: FlowTransactionSummaryDto | null
  transactionId: string
  updatedAt: Date
}

type FlowSignalDto = {
  consumedAt: Date | null
  correlationKeys: Record<string, unknown>
  createdAt: Date
  eventType: string
  id: string
  payload: Record<string, unknown>
  stepInstanceId: null | string
}

type FlowSnapshotDefinitionDto = {
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

type FlowStepAction = 'requeue' | 'retry'

export type FlowStepInstanceDto = {
  attempts: number
  correlation: null | Record<string, unknown>
  createdAt: Date
  endedAt: Date | null
  error: null | Record<string, unknown>
  flowInstanceId: string
  id: string
  input: null | Record<string, unknown>
  maxAttempts: number
  output: null | Record<string, unknown>
  startedAt: Date | null
  status: FlowStepStatus
  stepOrder: number
  stepType: FlowStepType
  updatedAt: Date
}

type FlowStepSummaryDto = {
  failed: number
  ready: number
  running: number
  skipped: number
  succeeded: number
  total: number
  waiting: number
}

type FlowTransactionDetailDto = FlowTransactionSummaryDto & {
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
  taxId: null | string
}

type FlowTransactionSummaryDto = {
  externalId: null | string
  id: string
  onChainId: null | string
  partner: { id: string, name: string }
  refundOnChainId: null | string
  status: TransactionStatus
}

type NormalizedFlowInstanceListFilters = Omit<FlowInstanceListFilters, 'createdFrom' | 'createdTo'> & {
  createdFrom?: Date
  createdTo?: Date
}

type ResolvedTransactionFilter = string | undefined | { in: string[] }

export class FlowInstanceNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowInstanceNotFoundError'
  }
}

export class FlowQueryValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'FlowQueryValidationError'
  }
}

export class FlowStepActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowStepActionError'
  }
}

export class FlowStepNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowStepNotFoundError'
  }
}

@injectable()
export class FlowAuditService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
  ) {}

  /**
   * Resume many stalled flow instances. Runs sequentially so each instance's
   * orchestrator pass completes before the next begins (correctness over speed
   * for an operator-triggered bulk action) and reports a per-instance outcome
   * so one failure never aborts the batch.
   */
  public async bulkRetry(flowInstanceIds: string[]): Promise<FlowBulkRetryResult[]> {
    const results: FlowBulkRetryResult[] = []

    for (const flowInstanceId of flowInstanceIds) {
      try {
        const step = await this.resumeInstance(flowInstanceId)
        results.push({ flowInstanceId, ok: true, stepInstanceId: step.id })
      }
      catch (error) {
        results.push({
          error: error instanceof Error ? error.message : 'Unknown error',
          flowInstanceId,
          ok: false,
        })
      }
    }

    return results
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
        include: {
          partnerUser: { select: { partner: { select: { id: true, name: true } } } },
          quote: true,
        },
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
            partner: transaction.partnerUser.partner,
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

  public async list(filters: FlowInstanceListFilters): Promise<FlowInstanceListResponse> {
    const client = await this.dbProvider.getClient()
    const normalized = this.normalizeFilters(filters)
    const page = this.normalizePage(normalized.page)
    const pageSize = this.normalizePageSize(normalized.pageSize)
    const transactionFilter = await this.resolveTransactionFilter(normalized)
    const baseWhere = this.buildWhere(normalized, transactionFilter, false)
    const resultWhere = this.buildWhere(normalized, transactionFilter, true)
    const [total, instances, statusGroups] = await client.$transaction([
      client.flowInstance.count({ where: resultWhere }),
      client.flowInstance.findMany({
        include: { steps: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where: resultWhere,
      }),
      client.flowInstance.groupBy({
        _count: { _all: true },
        by: ['status'],
        orderBy: { status: 'asc' },
        where: baseWhere,
      }),
    ])

    const transactionIds = instances.map(instance => instance.transactionId)
    const transactions = await client.transaction.findMany({
      select: {
        externalId: true,
        id: true,
        onChainId: true,
        partnerUser: { select: { partner: { select: { id: true, name: true } } } },
        refundOnChainId: true,
        status: true,
      },
      where: { id: { in: transactionIds } },
    })
    const transactionById = new Map(transactions.map(tx => [tx.id, tx]))

    const items = instances.map((instance) => {
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
              partner: transaction.partnerUser.partner,
              refundOnChainId: transaction.refundOnChainId,
              status: transaction.status,
            }
          : null,
        transactionId: instance.transactionId,
        updatedAt: instance.updatedAt,
      }
    })

    const statusCountMap = new Map(statusGroups.map((group) => {
      const count = typeof group._count === 'object' && group._count !== null
        ? group._count._all ?? 0
        : 0
      return [group.status, count] as const
    }))
    return {
      items,
      page,
      pageSize,
      statusCounts: Object.values(FlowInstanceStatus).map(status => ({
        count: statusCountMap.get(status) ?? 0,
        status,
      })),
      total,
    }
  }

  public async resetStep(
    flowInstanceId: string,
    stepInstanceId: string,
    action: FlowStepAction,
    options: { force?: boolean } = {},
  ): Promise<FlowStepInstanceDto> {
    const client = await this.dbProvider.getClient()
    const step = await client.flowStepInstance.findUnique({ where: { id: stepInstanceId } })

    if (!step || step.flowInstanceId !== flowInstanceId) {
      throw new FlowStepNotFoundError('Flow step instance not found')
    }

    const allowedStatuses: FlowStepStatus[] = action === 'retry'
      ? [FlowStepStatus.FAILED]
      : [FlowStepStatus.WAITING]

    // A force-reset additionally permits a stuck RUNNING step to be re-queued.
    // Operator-gated: re-running a non-idempotent money step
    // (PAYOUT_SEND / EXCHANGE_SEND / TREASURY_TRANSFER) risks double execution.
    if (options.force) {
      allowedStatuses.push(FlowStepStatus.RUNNING)
    }

    if (!allowedStatuses.includes(step.status)) {
      throw new FlowStepActionError(`Step is not in a ${allowedStatuses.join(' or ')} state`)
    }

    const updated = await client.flowStepInstance.update({
      data: {
        correlation: Prisma.DbNull,
        endedAt: null,
        retryAt: null,
        startedAt: null,
        status: FlowStepStatus.READY,
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

  /**
   * Resume a stalled flow instance by retrying its earliest FAILED step.
   * This is the instance-level counterpart to {@link resetStep}: an operator
   * does not need to know which step failed, only that the flow is stuck.
   */
  public async resumeInstance(flowInstanceId: string): Promise<FlowStepInstanceDto> {
    const client = await this.dbProvider.getClient()
    const instance = await client.flowInstance.findUnique({ where: { id: flowInstanceId } })

    if (!instance) {
      throw new FlowInstanceNotFoundError('Flow instance not found')
    }

    const failedStep = await client.flowStepInstance.findFirst({
      orderBy: { stepOrder: 'asc' },
      where: { flowInstanceId, status: FlowStepStatus.FAILED },
    })

    if (!failedStep) {
      throw new FlowStepActionError('Flow instance has no FAILED step to resume')
    }

    return this.resetStep(flowInstanceId, failedStep.id, 'retry')
  }

  private buildCurrentStep(
    steps: Array<{ status: FlowStepStatus, stepOrder: number, stepType: FlowStepType }>,
    currentStepOrder: null | number,
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
        case FlowStepStatus.FAILED:
          summary.failed += 1
          break
        case FlowStepStatus.NOT_STARTED:
          // Not tallied: NOT_STARTED steps have no summary bucket.
          break
        case FlowStepStatus.READY:
          summary.ready += 1
          break
        case FlowStepStatus.RUNNING:
          summary.running += 1
          break
        case FlowStepStatus.SKIPPED:
          summary.skipped += 1
          break
        case FlowStepStatus.SUCCEEDED:
          summary.succeeded += 1
          break
        case FlowStepStatus.WAITING:
          summary.waiting += 1
          break
      }
    }

    return summary
  }

  private buildWhere(
    filters: NormalizedFlowInstanceListFilters,
    transactionFilter: ResolvedTransactionFilter,
    includeStatus: boolean,
  ): Prisma.FlowInstanceWhereInput {
    const and: Prisma.FlowInstanceWhereInput[] = []

    if (transactionFilter !== undefined) and.push({ transactionId: transactionFilter })
    if (filters.createdFrom || filters.createdTo) {
      and.push({
        createdAt: {
          ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
          ...(filters.createdTo ? { lt: filters.createdTo } : {}),
        },
      })
    }
    if (includeStatus && filters.status) and.push({ status: filters.status })
    if (filters.blockchain) {
      and.push({ flowSnapshot: { equals: filters.blockchain, path: ['definition', 'blockchain'] } })
    }
    if (filters.cryptoCurrency) {
      and.push({ flowSnapshot: { equals: filters.cryptoCurrency, path: ['definition', 'cryptoCurrency'] } })
    }
    if (filters.payoutProvider) {
      and.push({ flowSnapshot: { equals: filters.payoutProvider, path: ['definition', 'payoutProvider'] } })
    }
    if (filters.targetCurrency) {
      and.push({ flowSnapshot: { equals: filters.targetCurrency, path: ['definition', 'targetCurrency'] } })
    }

    const stuckMinutes = this.normalizeStuckMinutes(filters.stuckMinutes)
    if (stuckMinutes) {
      and.push({
        status: FlowInstanceStatus.WAITING,
        updatedAt: { lte: new Date(Date.now() - stuckMinutes * 60 * 1_000) },
      })
    }
    if (filters.failure === 'FAILED_FLOW') and.push({ status: FlowInstanceStatus.FAILED })
    if (filters.failure === 'FAILED_STEP') and.push({ steps: { some: { status: FlowStepStatus.FAILED } } })
    if (filters.failure === 'STUCK_WAITING' && !stuckMinutes) {
      and.push({
        status: FlowInstanceStatus.WAITING,
        updatedAt: { lte: new Date(Date.now() - 30 * 60 * 1_000) },
      })
    }

    return and.length === 0 ? {} : { AND: and }
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

  private normalizeFilters(filters: FlowInstanceListFilters): NormalizedFlowInstanceListFilters {
    return {
      ...filters,
      createdFrom: this.parseDate(filters.createdFrom, 'createdFrom', false),
      createdTo: this.parseDate(filters.createdTo, 'createdTo', true),
      onChainId: filters.onChainId?.trim() || undefined,
      partnerId: filters.partnerId?.trim() || undefined,
      transactionId: filters.transactionId?.trim() || undefined,
    }
  }

  private normalizePage(page?: number): number {
    if (!page || page < 1) return 1
    return Math.floor(page)
  }

  private normalizePageSize(pageSize?: number): number {
    if (!pageSize || pageSize < 1) return 25
    return Math.min(Math.floor(pageSize), 200)
  }

  private normalizeStuckMinutes(stuckMinutes?: number): null | number {
    if (!stuckMinutes || stuckMinutes <= 0) return null
    return Math.floor(stuckMinutes)
  }

  private parseDate(value: string | undefined, field: string, endExclusive: boolean): Date | undefined {
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new FlowQueryValidationError(`${field} must be a valid date`)
    if (endExclusive && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCDate(date.getUTCDate() + 1)
    return date
  }

  private async resolveTransactionFilter(
    filters: NormalizedFlowInstanceListFilters,
  ): Promise<ResolvedTransactionFilter> {
    if (!filters.onChainId && !filters.partnerId) return filters.transactionId

    const client = await this.dbProvider.getClient()
    const matches = await client.transaction.findMany({
      select: { id: true },
      where: {
        ...(filters.onChainId ? { onChainId: filters.onChainId } : {}),
        ...(filters.partnerId ? { partnerUser: { partnerId: filters.partnerId } } : {}),
        ...(filters.transactionId ? { id: filters.transactionId } : {}),
      },
    })
    return { in: matches.map(match => match.id) }
  }

  private toRecord(value: null | Prisma.JsonValue): null | Record<string, unknown> {
    if (value === null || value === undefined) return null
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return { value }
  }
}
