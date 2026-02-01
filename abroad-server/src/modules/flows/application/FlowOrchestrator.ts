import { FlowInstanceStatus, FlowStepStatus, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { flowDefinitionSchema } from './flowDefinitionSchemas'
import { FlowExecutorRegistry } from './FlowExecutorRegistry'
import { FlowContext, FlowSignalInput, FlowSnapshot, FlowSnapshotStep, FlowStepRuntimeContext } from './flowTypes'

export class FlowNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowNotFoundError'
  }
}

@injectable()
export class FlowOrchestrator {
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.FlowExecutorRegistry) private readonly executorRegistry: FlowExecutorRegistry,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowOrchestrator' })
  }

  public async startFlow(transactionId: string): Promise<void> {
    const prisma = await this.dbProvider.getClient()

    const existing = await prisma.flowInstance.findUnique({ where: { transactionId } })
    if (existing) {
      this.logger.info('Flow instance already exists; resuming', { flowInstanceId: existing.id, transactionId })
      await this.run(existing.id)
      return
    }

    const transaction = await prisma.transaction.findUnique({
      include: { quote: true, partnerUser: { include: { partner: true } } },
      where: { id: transactionId },
    })

    if (!transaction) {
      throw new FlowNotFoundError('Transaction not found')
    }

    const definition = await prisma.flowDefinition.findFirst({
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      where: {
        blockchain: transaction.quote.network,
        cryptoCurrency: transaction.quote.cryptoCurrency,
        enabled: true,
        targetCurrency: transaction.quote.targetCurrency,
      },
    })

    if (!definition) {
      throw new FlowNotFoundError('No flow definition found for corridor')
    }

    const snapshot = this.buildSnapshot(definition)

    const instance = await prisma.flowInstance.create({
      data: {
        currentStepOrder: snapshot.steps[0]?.stepOrder ?? null,
        flowSnapshot: this.normalizeJson(snapshot),
        status: FlowInstanceStatus.IN_PROGRESS,
        steps: {
          create: snapshot.steps.map(step => ({
            stepOrder: step.stepOrder,
            stepType: step.stepType,
          })),
        },
        transactionId: transaction.id,
      },
    })

    this.logger.info('Flow instance created', { flowInstanceId: instance.id, transactionId })
    await this.run(instance.id)
  }

  public async handleSignal(signal: FlowSignalInput): Promise<void> {
    const prisma = await this.dbProvider.getClient()
    const flowInstance = signal.transactionId
      ? await prisma.flowInstance.findUnique({ where: { transactionId: signal.transactionId } })
      : null

    const signalRecord = await prisma.flowSignal.create({
      data: {
        correlationKeys: this.normalizeJson(signal.correlationKeys),
        eventType: signal.eventType,
        flowInstanceId: flowInstance?.id ?? null,
        payload: this.normalizeJson(signal.payload),
      },
    })

    if (!flowInstance) {
      this.logger.warn('Flow signal stored without matching instance', { eventType: signal.eventType })
      return
    }

    const waitingSteps = await prisma.flowStepInstance.findMany({
      orderBy: { stepOrder: 'asc' },
      where: {
        flowInstanceId: flowInstance.id,
        status: FlowStepStatus.WAITING,
      },
    })

    if (waitingSteps.length === 0) {
      return
    }

    const runtime = await this.buildRuntimeContext(flowInstance.id)
    const snapshot = this.readSnapshot(flowInstance.flowSnapshot)

    for (const step of waitingSteps) {
      const definition = snapshot.steps.find(item => item.stepOrder === step.stepOrder)
      if (!definition) {
        continue
      }

      const correlation = this.jsonToRecord(step.correlation)
      if (!this.matchesCorrelation(correlation, signal.correlationKeys)) {
        continue
      }

      const executor = this.executorRegistry.get(step.stepType)
      if (!executor.handleSignal) {
        await prisma.flowStepInstance.update({
          data: {
            endedAt: new Date(),
            status: FlowStepStatus.SUCCEEDED,
          },
          where: { id: step.id },
        })
        await prisma.flowSignal.update({
          data: { consumedAt: new Date(), stepInstanceId: step.id },
          where: { id: signalRecord.id },
        })
        await this.run(flowInstance.id)
        return
      }

      const result = await executor.handleSignal({
        config: definition.config,
        runtime,
        signal,
        stepOrder: step.stepOrder,
      })

      await this.persistStepOutcome(step.id, result)
      await prisma.flowSignal.update({
        data: { consumedAt: new Date(), stepInstanceId: step.id },
        where: { id: signalRecord.id },
      })

      if (result.outcome === 'succeeded') {
        await this.run(flowInstance.id)
      }

      return
    }
  }

  public async run(flowInstanceId: string): Promise<void> {
    const prisma = await this.dbProvider.getClient()
    await prisma.flowInstance.updateMany({
      data: { status: FlowInstanceStatus.IN_PROGRESS },
      where: { id: flowInstanceId, status: FlowInstanceStatus.WAITING },
    })
    let claimed = await this.claimNextStep(prisma, flowInstanceId)

    while (claimed) {
      const current = claimed
      const runtime = await this.buildRuntimeContext(flowInstanceId)
      const snapshot = this.readSnapshot(runtime.flowSnapshot)
      const stepDefinition = snapshot.steps.find(step => step.stepOrder === current.stepOrder)
      if (!stepDefinition) {
        await prisma.flowStepInstance.update({
          data: { status: FlowStepStatus.FAILED, endedAt: new Date(), error: { message: 'Step definition missing' } },
          where: { id: current.id },
        })
        await prisma.flowInstance.update({
          data: { status: FlowInstanceStatus.FAILED },
          where: { id: flowInstanceId },
        })
        return
      }

      const executor = this.executorRegistry.get(current.stepType)
      await prisma.flowStepInstance.update({
        data: {
          input: this.normalizeJson({
            config: stepDefinition.config,
            context: runtime.context,
          }),
        },
        where: { id: current.id },
      })
      const result = await executor.execute({
        config: stepDefinition.config,
        runtime,
        stepOrder: current.stepOrder,
      })

      await this.persistStepOutcome(current.id, result)

      if (result.outcome === 'waiting' || result.outcome === 'failed') {
        await prisma.flowInstance.update({
          data: {
            status: result.outcome === 'waiting' ? FlowInstanceStatus.WAITING : FlowInstanceStatus.FAILED,
          },
          where: { id: flowInstanceId },
        })
        return
      }

      const nextOrder = this.resolveNextOrder(snapshot.steps, current.stepOrder)
      await prisma.flowInstance.update({
        data: { currentStepOrder: nextOrder },
        where: { id: flowInstanceId },
      })

      claimed = await this.claimNextStep(prisma, flowInstanceId)
    }

    await prisma.flowInstance.update({
      data: { status: FlowInstanceStatus.COMPLETED },
      where: { id: flowInstanceId },
    })
  }

  private async buildRuntimeContext(flowInstanceId: string): Promise<FlowStepRuntimeContext & { flowSnapshot: unknown }> {
    const prisma = await this.dbProvider.getClient()
    const instance = await prisma.flowInstance.findUnique({
      include: { steps: true },
      where: { id: flowInstanceId },
    })

    if (!instance) {
      throw new FlowNotFoundError('Flow instance not found')
    }

    const transaction = await prisma.transaction.findUnique({
      include: { quote: true, partnerUser: true },
      where: { id: instance.transactionId },
    })

    if (!transaction) {
      throw new FlowNotFoundError('Transaction not found for flow instance')
    }

    const context: FlowContext = {
      accountNumber: transaction.accountNumber,
      bankCode: transaction.bankCode,
      blockchain: transaction.quote.network,
      cryptoCurrency: transaction.quote.cryptoCurrency,
      externalId: transaction.externalId,
      onChainId: transaction.onChainId,
      partnerId: transaction.partnerUser.partnerId,
      partnerUserId: transaction.partnerUserId,
      paymentMethod: transaction.quote.paymentMethod,
      qrCode: transaction.qrCode ?? null,
      quoteId: transaction.quoteId,
      sourceAmount: transaction.quote.sourceAmount,
      targetAmount: transaction.quote.targetAmount,
      targetCurrency: transaction.quote.targetCurrency,
      taxId: transaction.taxId ?? null,
      transactionId: transaction.id,
    }

    const stepOutputs = new Map<number, Record<string, unknown>>()
    for (const step of instance.steps) {
      if (step.output) {
        stepOutputs.set(step.stepOrder, this.jsonToRecord(step.output))
      }
    }

    return {
      context,
      flowSnapshot: instance.flowSnapshot,
      stepOutputs,
    }
  }

  private async claimNextStep(prisma: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>, flowInstanceId: string) {
    const next = await prisma.flowStepInstance.findFirst({
      orderBy: { stepOrder: 'asc' },
      where: { flowInstanceId, status: FlowStepStatus.READY },
    })

    if (!next) {
      return null
    }

    const updated = await prisma.flowStepInstance.updateMany({
      data: {
        attempts: { increment: 1 },
        startedAt: new Date(),
        status: FlowStepStatus.RUNNING,
      },
      where: { id: next.id, status: FlowStepStatus.READY },
    })

    if (updated.count === 0) {
      return null
    }

    return next
  }

  private buildSnapshot(definition: {
    id: string
    name: string
    blockchain: FlowSnapshot['definition']['blockchain']
    cryptoCurrency: FlowSnapshot['definition']['cryptoCurrency']
    exchangeFeePct: number
    fixedFee: number
    maxAmount: number | null
    minAmount: number | null
    pricingProvider: FlowSnapshot['definition']['pricingProvider']
    targetCurrency: FlowSnapshot['definition']['targetCurrency']
    steps: Array<{
      stepOrder: number
      stepType: FlowSnapshotStep['stepType']
      completionPolicy: FlowSnapshotStep['completionPolicy']
      config: unknown
      signalMatch: unknown | null
    }>
  }): FlowSnapshot {
    return {
      definition: {
        blockchain: definition.blockchain,
        cryptoCurrency: definition.cryptoCurrency,
        exchangeFeePct: definition.exchangeFeePct,
        fixedFee: definition.fixedFee,
        id: definition.id,
        maxAmount: definition.maxAmount,
        minAmount: definition.minAmount,
        name: definition.name,
        pricingProvider: definition.pricingProvider,
        targetCurrency: definition.targetCurrency,
      },
      steps: definition.steps.map(step => ({
        completionPolicy: step.completionPolicy,
        config: this.jsonToRecord(step.config),
        signalMatch: step.signalMatch ? this.jsonToRecord(step.signalMatch) : null,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
      })),
    }
  }

  private readSnapshot(raw: unknown): FlowSnapshot {
    const candidate = raw as FlowSnapshot
    const parse = flowDefinitionSchema.safeParse({
      blockchain: candidate.definition.blockchain,
      cryptoCurrency: candidate.definition.cryptoCurrency,
      exchangeFeePct: candidate.definition.exchangeFeePct,
      fixedFee: candidate.definition.fixedFee,
      maxAmount: candidate.definition.maxAmount ?? undefined,
      minAmount: candidate.definition.minAmount ?? undefined,
      name: candidate.definition.name,
      pricingProvider: candidate.definition.pricingProvider,
      steps: candidate.steps.map(step => ({
        completionPolicy: step.completionPolicy,
        config: step.config,
        signalMatch: step.signalMatch ?? undefined,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
      })),
      targetCurrency: candidate.definition.targetCurrency,
    })

    if (!parse.success) {
      throw new Error(`Invalid flow snapshot: ${parse.error.message}`)
    }

    return candidate
  }

  private async persistStepOutcome(stepInstanceId: string, result: {
    outcome: 'succeeded' | 'waiting' | 'failed'
    output?: Record<string, unknown>
    correlation?: Record<string, unknown>
    error?: string
  }): Promise<void> {
    const prisma = await this.dbProvider.getClient()
    const now = new Date()

    if (result.outcome === 'waiting') {
      await prisma.flowStepInstance.update({
        data: {
          correlation: result.correlation ? this.normalizeJson(result.correlation) : undefined,
          output: result.output ? this.normalizeJson(result.output) : undefined,
          status: FlowStepStatus.WAITING,
        },
        where: { id: stepInstanceId },
      })
      return
    }

    await prisma.flowStepInstance.update({
      data: {
        correlation: result.correlation ? this.normalizeJson(result.correlation) : undefined,
        endedAt: now,
        error: result.error ? this.normalizeJson({ message: result.error }) : undefined,
        output: result.output ? this.normalizeJson(result.output) : undefined,
        status: result.outcome === 'succeeded' ? FlowStepStatus.SUCCEEDED : FlowStepStatus.FAILED,
      },
      where: { id: stepInstanceId },
    })
  }

  private resolveNextOrder(steps: FlowSnapshotStep[], current: number): number | null {
    const orders = steps.map(step => step.stepOrder).sort((a, b) => a - b)
    const currentIndex = orders.indexOf(current)
    if (currentIndex < 0 || currentIndex + 1 >= orders.length) return null
    return orders[currentIndex + 1]
  }

  private normalizeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
  }

  private jsonToRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return { value }
  }

  private matchesCorrelation(
    expected: Record<string, unknown>,
    actual: Record<string, boolean | number | string>,
  ): boolean {
    return Object.entries(expected).every(([key, value]) => actual[key] === value)
  }
}
