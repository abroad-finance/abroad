import 'reflect-metadata'

import type { Prisma, PrismaClient } from '@prisma/client'

import { OpsIntegrationKind, OpsIntegrationStatus, OpsRole } from '@prisma/client'

import { OpsUserPrincipal } from '../../../../modules/operations/application/opsIdentity'
import { OpsIntegrationService, OpsIntegrationValidationError } from '../../../../modules/operations/application/OpsIntegrationService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const principal: OpsUserPrincipal = {
  authTime: new Date(),
  displayName: 'Administrator',
  email: 'admin@abroad.finance',
  kind: 'ops_user',
  permissions: ['administration:integrations', 'incidents:read'],
  role: OpsRole.ADMINISTRATOR,
  sessionVersion: 1,
  userId: 'admin-1',
}

const buildHarness = () => {
  const now = new Date('2026-08-02T16:00:00.000Z')
  const prisma = {
    opsIntegration: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        configuration: data.configuration,
        createdAt: now,
        description: data.description,
        id: 'integration-1',
        kind: data.kind,
        lastCheckedAt: null,
        lastErrorCode: null,
        name: data.name,
        status: data.status,
        updatedAt: now,
        version: 1,
      })),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    opsRunbook: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        createdAt: now,
        id: 'runbook-1',
        updatedAt: now,
        version: 1,
      })),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  }
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return {
    prisma,
    service: new OpsIntegrationService(provider),
    transaction: prisma as unknown as Prisma.TransactionClient,
  }
}

describe('OpsIntegrationService', () => {
  it('stores only public notification aliases and normalized event kinds', async () => {
    const harness = buildHarness()

    const result = await harness.service.createIntegration(principal, {
      configuration: {
        destinationLabel: 'Operations alerts',
        eventKinds: [' liquidity ', 'liquidity', 'provider'],
        healthcheckName: 'Primary delivery monitor',
        provider: 'Slack',
      },
      description: 'Routes operational incident notifications.',
      kind: OpsIntegrationKind.NOTIFICATION,
      name: 'Ops notifications',
      status: OpsIntegrationStatus.ACTIVE,
    }, harness.transaction)

    expect(result.configuration).toEqual({
      destinationLabel: 'Operations alerts',
      eventKinds: ['liquidity', 'provider'],
      healthcheckName: 'Primary delivery monitor',
      provider: 'Slack',
    })
    expect(JSON.stringify(harness.prisma.opsIntegration.create.mock.calls[0])).not.toMatch(/https?:|token|secret/i)
  })

  it('rejects credential-shaped integration labels and unsafe runbook URLs', async () => {
    const harness = buildHarness()
    const integration = {
      configuration: { destinationLabel: 'Bearer token abc' },
      description: 'Routes operational incident notifications.',
      kind: OpsIntegrationKind.NOTIFICATION,
      name: 'Ops notifications',
      status: OpsIntegrationStatus.ACTIVE,
    }

    await expect(harness.service.createIntegration(principal, integration, harness.transaction))
      .rejects.toBeInstanceOf(OpsIntegrationValidationError)
    await expect(harness.service.createRunbook(principal, {
      active: true,
      description: 'Respond to provider throttling.',
      incidentKinds: ['RATE_LIMIT'],
      name: 'Provider throttling',
      slug: 'provider-throttling',
      url: 'https://runbooks.abroad.finance/provider?token=secret',
    }, harness.transaction)).rejects.toBeInstanceOf(OpsIntegrationValidationError)
    expect(harness.prisma.opsIntegration.create).not.toHaveBeenCalled()
    expect(harness.prisma.opsRunbook.create).not.toHaveBeenCalled()
  })
})
