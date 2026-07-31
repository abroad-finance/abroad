import type { PrismaClient } from '@prisma/client'

import { FlowInstanceStatus, FlowStepStatus, FlowStepType, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { FlowOrchestrator } from './FlowOrchestrator'

const RUNNABLE_FLOW_STATUSES = [
  FlowInstanceStatus.IN_PROGRESS,
  FlowInstanceStatus.NOT_STARTED,
  FlowInstanceStatus.WAITING,
] as const

type FlowRetryWorkerOptions = {
  batchSize?: number
  pollIntervalMs?: number
}

@injectable()
export class FlowRetryWorker {
  private readonly activationConflict = new Error('Flow retry activation conflict')
  private readonly batchSize: number
  private cancelSleep: (() => void) | null = null
  private isRunning = false
  private readonly logger: ScopedLogger
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number

  public constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: FlowRetryWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? this.readPositiveInteger('FLOW_RETRY_BATCH_SIZE', 50)
    this.pollIntervalMs = options.pollIntervalMs ?? this.readPositiveInteger('FLOW_RETRY_INTERVAL_MS', 15_000)
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowRetryWorker' })
  }

  public async runOnce(now = new Date()): Promise<void> {
    try {
      const prisma = await this.dbProvider.getClient()
      const candidates = await prisma.flowStepInstance.findMany({
        orderBy: [{ retryAt: 'asc' }, { updatedAt: 'asc' }],
        select: {
          attempts: true,
          flowInstanceId: true,
          id: true,
          maxAttempts: true,
          retryAt: true,
          status: true,
          stepOrder: true,
        },
        take: this.batchSize,
        where: {
          flowInstance: { status: { in: [...RUNNABLE_FLOW_STATUSES] } },
          OR: [
            { retryAt: { lte: now }, status: FlowStepStatus.WAITING },
            { status: FlowStepStatus.READY },
          ],
          stepType: FlowStepType.PAYOUT_SEND,
        },
      })

      const scheduledFlows = new Set<string>()
      for (const candidate of candidates) {
        if (scheduledFlows.has(candidate.flowInstanceId)) continue

        const isInvalidCandidate = candidate.attempts >= candidate.maxAttempts
          || (candidate.status === FlowStepStatus.WAITING && !candidate.retryAt)
        if (isInvalidCandidate) {
          this.logger.error('Invalid due payout retry state', {
            attempts: candidate.attempts,
            maxAttempts: candidate.maxAttempts,
            stepInstanceId: candidate.id,
          })
          continue
        }

        if (candidate.status === FlowStepStatus.WAITING) {
          const activated = await this.activateDueStep(prisma, {
            attempts: candidate.attempts,
            flowInstanceId: candidate.flowInstanceId,
            id: candidate.id,
            maxAttempts: candidate.maxAttempts,
            now,
            stepOrder: candidate.stepOrder,
          })
          if (!activated) continue
        }

        scheduledFlows.add(candidate.flowInstanceId)
        try {
          await this.orchestrator.run(candidate.flowInstanceId)
        }
        catch (error) {
          this.logger.error('Flow retry execution failed', {
            error,
            flowInstanceId: candidate.flowInstanceId,
            stepInstanceId: candidate.id,
          })
        }
      }
    }
    catch (error) {
      this.logger.error('Flow retry tick failed', error)
    }
  }

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.loopPromise = this.loop()
  }

  public async stop(): Promise<void> {
    this.isRunning = false
    this.cancelSleep?.()
    if (this.loopPromise) await this.loopPromise
    this.loopPromise = null
  }

  private async activateDueStep(
    prisma: PrismaClient,
    candidate: {
      attempts: number
      flowInstanceId: string
      id: string
      maxAttempts: number
      now: Date
      stepOrder: number
    },
  ): Promise<boolean> {
    try {
      return await prisma.$transaction(async (tx) => {
        const flow = await tx.flowInstance.updateMany({
          data: {
            currentStepOrder: candidate.stepOrder,
            status: FlowInstanceStatus.IN_PROGRESS,
          },
          where: {
            id: candidate.flowInstanceId,
            status: { in: [...RUNNABLE_FLOW_STATUSES] },
          },
        })
        if (flow.count === 0) return false

        const step = await tx.flowStepInstance.updateMany({
          data: {
            correlation: Prisma.DbNull,
            retryAt: null,
            status: FlowStepStatus.READY,
          },
          where: {
            attempts: candidate.attempts,
            id: candidate.id,
            maxAttempts: candidate.maxAttempts,
            retryAt: { lte: candidate.now },
            status: FlowStepStatus.WAITING,
            stepType: FlowStepType.PAYOUT_SEND,
          },
        })
        if (step.count === 0) throw this.activationConflict
        return true
      })
    }
    catch (error) {
      if (error === this.activationConflict) return false
      throw error
    }
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      await this.runOnce()
      if (this.isRunning) await this.sleep(this.pollIntervalMs)
    }
  }

  private readPositiveInteger(key: string, fallback: number): number {
    const value = Number(process.env[key])
    return Number.isInteger(value) && value > 0 ? value : fallback
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cancelSleep = null
        resolve()
      }, ms)
      this.cancelSleep = () => {
        clearTimeout(timer)
        this.cancelSleep = null
        resolve()
      }
    })
  }
}
