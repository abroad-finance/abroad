import 'reflect-metadata'
import { OpsRole, OpsTaskResult } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsTaskTelemetryInput, OpsTaskTelemetryService, OpsTaskTelemetryValidationError } from '../../../../modules/operations/application/OpsTaskTelemetryService'

const principal = {
  authTime: new Date('2026-08-02T12:00:00.000Z'),
  displayName: 'Support Operator',
  email: 'support@abroad.finance',
  kind: 'ops_user' as const,
  permissions: ['overview:read'] as const,
  role: OpsRole.SUPPORT,
  sessionVersion: 1,
  userId: 'ops-user-1',
}

describe('OpsTaskTelemetryService', () => {
  it('stores only the allowlisted task dimensions and named actor', async () => {
    const create = jest.fn(async (input: unknown) => input)
    const service = new OpsTaskTelemetryService({
      getClient: jest.fn(async () => ({
        opsTaskEvent: { create },
      }) as unknown as import('@prisma/client').PrismaClient),
    })

    await service.record(principal, {
      action: 'RESULT_OPENED',
      durationMs: 1_250,
      metadata: {
        entryPoint: 'TRANSACTION',
        viewport: 'MOBILE',
      },
      result: OpsTaskResult.SUCCEEDED,
      task: 'GLOBAL_SEARCH',
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        action: 'RESULT_OPENED',
        actorUserId: 'ops-user-1',
        durationMs: 1_250,
        metadata: {
          entryPoint: 'TRANSACTION',
          viewport: 'MOBILE',
        },
        result: OpsTaskResult.SUCCEEDED,
        task: 'GLOBAL_SEARCH',
      },
    })
    expect(JSON.stringify(create.mock.calls[0])).not.toMatch(/query|customer|identifier|errorText/i)
  })

  it('rejects a mismatched action and unrecognized metadata', async () => {
    const create = jest.fn()
    const service = new OpsTaskTelemetryService({
      getClient: jest.fn(async () => ({
        opsTaskEvent: { create },
      }) as unknown as import('@prisma/client').PrismaClient),
    })
    const invalid = {
      action: 'RESULT_OPENED',
      metadata: {
        rawQuery: 'must-not-be-stored',
        viewport: 'DESKTOP',
      },
      result: OpsTaskResult.SUCCEEDED,
      task: 'MUTATION',
    } as unknown as OpsTaskTelemetryInput

    await expect(service.record(principal, invalid)).rejects.toBeInstanceOf(
      OpsTaskTelemetryValidationError,
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('aggregates completion and duration by task, action, and viewport', async () => {
    const findMany = jest.fn(async () => [{
      action: 'COMPLETED',
      durationMs: 1_000,
      metadata: { viewport: 'MOBILE' },
      result: OpsTaskResult.SUCCEEDED,
      task: 'PROOF_RETRIEVAL',
    }, {
      action: 'COMPLETED',
      durationMs: 3_000,
      metadata: { failureClass: 'NETWORK', viewport: 'MOBILE' },
      result: OpsTaskResult.FAILED,
      task: 'PROOF_RETRIEVAL',
    }, {
      action: 'COMPLETED',
      durationMs: null,
      metadata: { viewport: 'DESKTOP' },
      result: OpsTaskResult.ABANDONED,
      task: 'MUTATION',
    }, {
      action: 'COMPLETED',
      durationMs: 10,
      metadata: { viewport: 'UNSUPPORTED' },
      result: OpsTaskResult.SUCCEEDED,
      task: 'MUTATION',
    }])
    const databaseClientProvider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => ({
        opsTaskEvent: { findMany },
      }) as unknown as import('@prisma/client').PrismaClient),
    }
    const service = new OpsTaskTelemetryService(databaseClientProvider)
    const from = new Date('2026-08-01T00:00:00.000Z')
    const to = new Date('2026-08-03T00:00:00.000Z')

    const summary = await service.summarize(from, to)

    expect(summary).toEqual({
      from,
      metrics: [{
        abandoned: 1,
        action: 'COMPLETED',
        averageDurationMs: null,
        failed: 0,
        succeeded: 0,
        task: 'MUTATION',
        total: 1,
        viewport: 'DESKTOP',
      }, {
        abandoned: 0,
        action: 'COMPLETED',
        averageDurationMs: 2_000,
        failed: 1,
        succeeded: 1,
        task: 'PROOF_RETRIEVAL',
        total: 2,
        viewport: 'MOBILE',
      }],
      to,
      truncated: false,
    })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdAt: { gte: from, lt: to } },
    }))
  })
})
