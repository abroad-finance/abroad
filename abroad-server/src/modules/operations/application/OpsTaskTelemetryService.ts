import { OpsTaskResult, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsPrincipal } from './opsIdentity'

const MAX_DURATION_MS = 60 * 60 * 1_000
const MAX_SUMMARY_EVENTS = 20_000

const taskActionMap = {
  GLOBAL_SEARCH: ['SUBMITTED', 'RESULT_OPENED'],
  INCIDENT_OWNERSHIP: ['REQUESTED', 'COMPLETED'],
  MUTATION: ['REQUESTED', 'COMPLETED'],
  PROOF_RETRIEVAL: ['REQUESTED', 'COMPLETED'],
} as const

export type OpsTaskTelemetryInput = {
  action: OpsTaskTelemetryAction
  durationMs?: number
  metadata: {
    entryPoint?: 'CASE' | 'FLOW' | 'INCIDENT' | 'PARTNER' | 'TRANSACTION'
    failureClass?: 'AUTHORIZATION' | 'CONFLICT' | 'NETWORK' | 'PROVIDER' | 'UNKNOWN' | 'VALIDATION'
    viewport: OpsTaskTelemetryViewport
  }
  result: OpsTaskResult
  task: OpsTaskTelemetryTask
}
export type OpsTaskTelemetrySummary = {
  from: Date
  metrics: OpsTaskTelemetryMetric[]
  to: Date
  truncated: boolean
}
type OpsTaskTelemetryAction = typeof taskActionMap[keyof typeof taskActionMap][number]

type OpsTaskTelemetryMetric = {
  abandoned: number
  action: string
  averageDurationMs: null | number
  failed: number
  succeeded: number
  task: string
  total: number
  viewport: OpsTaskTelemetryViewport
}

type OpsTaskTelemetryTask = keyof typeof taskActionMap

type OpsTaskTelemetryViewport = 'DESKTOP' | 'MOBILE' | 'TABLET'

const metadataSchema = z.object({
  entryPoint: z.enum(['CASE', 'FLOW', 'INCIDENT', 'PARTNER', 'TRANSACTION']).optional(),
  failureClass: z.enum([
    'AUTHORIZATION',
    'CONFLICT',
    'NETWORK',
    'PROVIDER',
    'UNKNOWN',
    'VALIDATION',
  ]).optional(),
  viewport: z.enum(['DESKTOP', 'MOBILE', 'TABLET']),
}).strict()

export const opsTaskTelemetryInputSchema: z.ZodType<OpsTaskTelemetryInput> = z.object({
  action: z.enum(['COMPLETED', 'REQUESTED', 'RESULT_OPENED', 'SUBMITTED']),
  durationMs: z.number().int().min(0).max(MAX_DURATION_MS).optional(),
  metadata: metadataSchema,
  result: z.nativeEnum(OpsTaskResult),
  task: z.enum(['GLOBAL_SEARCH', 'INCIDENT_OWNERSHIP', 'MUTATION', 'PROOF_RETRIEVAL']),
}).strict().superRefine((input, context) => {
  const allowedActions: readonly string[] = taskActionMap[input.task]
  if (!allowedActions.includes(input.action)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${input.action} is not valid for ${input.task}`,
      path: ['action'],
    })
  }
})

type MetricAccumulator = {
  abandoned: number
  action: string
  durationCount: number
  durationTotal: number
  failed: number
  succeeded: number
  task: string
  total: number
  viewport: OpsTaskTelemetryViewport
}

@injectable()
export class OpsTaskTelemetryService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async record(
    principal: OpsPrincipal,
    input: OpsTaskTelemetryInput,
  ): Promise<void> {
    const parsed = opsTaskTelemetryInputSchema.safeParse(input)
    if (!parsed.success) throw new OpsTaskTelemetryValidationError(parsed.error.issues[0]?.message)

    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.opsTaskEvent.create({
      data: {
        action: parsed.data.action,
        actorUserId: principal.userId,
        durationMs: parsed.data.durationMs,
        metadata: parsed.data.metadata,
        result: parsed.data.result,
        task: parsed.data.task,
      },
    })
  }

  public async summarize(from: Date, to: Date): Promise<OpsTaskTelemetrySummary> {
    if (
      !Number.isFinite(from.getTime())
      || !Number.isFinite(to.getTime())
      || from >= to
      || to.getTime() - from.getTime() > 93 * 24 * 60 * 60 * 1_000
    ) {
      throw new OpsTaskTelemetryValidationError('Select a valid telemetry window of up to 93 days')
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    const events = await prismaClient.opsTaskEvent.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        action: true,
        durationMs: true,
        metadata: true,
        result: true,
        task: true,
      },
      take: MAX_SUMMARY_EVENTS + 1,
      where: { createdAt: { gte: from, lt: to } },
    })
    const accumulators = new Map<string, MetricAccumulator>()

    for (const event of events.slice(0, MAX_SUMMARY_EVENTS)) {
      const viewport = this.readViewport(event.metadata)
      if (!viewport) continue
      const key = `${event.task}:${event.action}:${viewport}`
      const metric = accumulators.get(key) ?? {
        abandoned: 0,
        action: event.action,
        durationCount: 0,
        durationTotal: 0,
        failed: 0,
        succeeded: 0,
        task: event.task,
        total: 0,
        viewport,
      }
      metric.total += 1
      if (event.result === OpsTaskResult.SUCCEEDED) metric.succeeded += 1
      if (event.result === OpsTaskResult.FAILED) metric.failed += 1
      if (event.result === OpsTaskResult.ABANDONED) metric.abandoned += 1
      if (event.durationMs !== null) {
        metric.durationCount += 1
        metric.durationTotal += event.durationMs
      }
      accumulators.set(key, metric)
    }

    return {
      from,
      metrics: [...accumulators.values()]
        .sort((left, right) => (
          left.task.localeCompare(right.task)
          || left.action.localeCompare(right.action)
          || left.viewport.localeCompare(right.viewport)
        ))
        .map(metric => ({
          abandoned: metric.abandoned,
          action: metric.action,
          averageDurationMs: metric.durationCount > 0
            ? Math.round(metric.durationTotal / metric.durationCount)
            : null,
          failed: metric.failed,
          succeeded: metric.succeeded,
          task: metric.task,
          total: metric.total,
          viewport: metric.viewport,
        })),
      to,
      truncated: events.length > MAX_SUMMARY_EVENTS,
    }
  }

  private readViewport(metadata: null | Prisma.JsonValue): null | OpsTaskTelemetryViewport {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null
    const viewport = metadata.viewport
    return viewport === 'DESKTOP' || viewport === 'MOBILE' || viewport === 'TABLET'
      ? viewport
      : null
  }
}

export class OpsTaskTelemetryValidationError extends Error {
  public constructor(message = 'Invalid task telemetry event') {
    super(message)
    this.name = 'OpsTaskTelemetryValidationError'
  }
}
