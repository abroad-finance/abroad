import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import { PartnerAiClientKind, PartnerAiScope, PartnerPortalRole, Prisma } from '@prisma/client'

import { PARTNER_AI_MCP_SERVER_VERSION } from '../../../../modules/partners/application/partnerAiConfiguration'
import { PartnerAiConnectionService } from '../../../../modules/partners/application/PartnerAiConnectionService'
import { PartnerAiPortalError } from '../../../../modules/partners/application/PartnerAiErrors'
import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalPrincipal } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const principal = (overrides: Partial<PartnerPortalPrincipal> = {}): PartnerPortalPrincipal => ({
  authenticationSource: 'PARTNER_PORTAL',
  email: 'admin@partner.example',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner: { id: 'partner-1', name: 'Atlas Payments' } as PartnerPortalPrincipal['partner'],
  role: PartnerPortalRole.ADMIN,
  userId: 'portal-user-1',
  ...overrides,
})

const now = new Date('2026-08-02T18:00:00.000Z')

const connectionRecord = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  activeGrantKey: 'active-grant',
  authorizedAt: new Date('2026-08-01T18:00:00.000Z'),
  authorizedByUserId: 'portal-user-1',
  createdAt: new Date('2026-08-01T18:00:00.000Z'),
  expiresAt: new Date('2026-09-01T18:00:00.000Z'),
  failedAt: null,
  failureCode: null,
  id: 'connection-1',
  lastTestedAt: null,
  lastUsedAt: null,
  oauthClient: {
    clientName: 'Operations Assistant',
    verifiedKind: PartnerAiClientKind.GENERIC,
  },
  oauthClientId: 'oauth-client-1',
  partnerId: 'partner-1',
  revokedAt: null,
  scopes: [PartnerAiScope.ACCOUNT_READ, PartnerAiScope.TRANSACTIONS_READ],
  updatedAt: new Date('2026-08-01T18:00:00.000Z'),
  ...overrides,
})

const buildHarness = (records = [connectionRecord()]) => {
  const findMany = jest.fn(async () => records)
  const findFirst = jest.fn(async () => records[0] ?? null)
  const update = jest.fn(async () => records[0])
  const connectionUpdateMany = jest.fn(async () => ({ count: 1 }))
  const accessUpdateMany = jest.fn(async () => ({ count: 1 }))
  const refreshUpdateMany = jest.fn(async () => ({ count: 1 }))
  const transactionClient = {
    partnerAiAccessToken: { updateMany: accessUpdateMany },
    partnerAiConnection: { updateMany: connectionUpdateMany },
    partnerAiRefreshToken: { updateMany: refreshUpdateMany },
  }
  const transaction = jest.fn<Promise<unknown>, [TransactionCallback]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      $transaction: transaction,
      partnerAiConnection: { findFirst, findMany, update },
    }) as unknown as PrismaClient),
  }
  const auditRecord = jest.fn(async () => undefined)
  return {
    accessUpdateMany,
    auditRecord,
    connectionUpdateMany,
    databaseClientProvider,
    findFirst,
    findMany,
    refreshUpdateMany,
    service: new PartnerAiConnectionService(
      databaseClientProvider,
      { record: auditRecord } as unknown as PartnerPortalAuditService,
    ),
    transaction,
    update,
  }
}

describe('PartnerAiConnectionService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('lists only the current tenant and derives every visible connection status', async () => {
    const harness = buildHarness([
      connectionRecord(),
      connectionRecord({
        activeGrantKey: null,
        expiresAt: new Date('2026-08-02T17:59:00.000Z'),
        id: 'connection-expired',
      }),
      connectionRecord({ activeGrantKey: null, id: 'connection-revoked', revokedAt: now }),
      connectionRecord({ activeGrantKey: null, failedAt: now, id: 'connection-failed' }),
    ])

    const result = await harness.service.list(principal())

    expect(harness.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      where: { partnerId: 'partner-1' },
    }))
    expect(result.map(connection => connection.status)).toEqual([
      'ACTIVE',
      'EXPIRED',
      'REVOKED',
      'FAILED',
    ])
    expect(result[0]).toEqual(expect.objectContaining({
      clientName: 'Operations Assistant',
      scopes: ['account:read', 'transactions:read'],
      verifiedClient: false,
    }))
  })

  it('tests account metadata only for a tenant-owned active connection', async () => {
    const harness = buildHarness()

    const result = await harness.service.test(principal(), 'connection-1')

    expect(harness.findFirst).toHaveBeenCalledWith({
      where: { id: 'connection-1', partnerId: 'partner-1' },
    })
    expect(harness.update).toHaveBeenCalledWith({
      data: { lastTestedAt: now },
      where: { id: 'connection-1' },
    })
    expect(result).toEqual({
      connectionId: 'connection-1',
      organizationName: 'Atlas Payments',
      resource: 'https://api.abroad.finance/mcp',
      scopes: ['account:read', 'transactions:read'],
      serverVersion: PARTNER_AI_MCP_SERVER_VERSION,
      status: 'ACTIVE',
    })
    expect(JSON.stringify(result)).not.toContain('transactionId')
    expect(JSON.stringify(result)).not.toContain('webhook')
  })

  it('returns the same not-found result for missing and cross-tenant connection IDs', async () => {
    const harness = buildHarness([])

    await expect(harness.service.test(principal(), 'connection-other-tenant')).rejects.toEqual(
      new PartnerAiPortalError('NOT_FOUND', 'Connected AI client not found'),
    )
    await expect(harness.service.revoke(principal(), 'connection-other-tenant')).rejects.toEqual(
      new PartnerAiPortalError('NOT_FOUND', 'Connected AI client not found'),
    )
    expect(harness.transaction).not.toHaveBeenCalled()
  })

  it.each([
    principal({ role: PartnerPortalRole.MEMBER }),
    principal({ mfaVerified: false }),
  ])('requires an MFA-verified administrator before loading a revoke target', async (actor) => {
    const harness = buildHarness()

    await expect(harness.service.revoke(actor, 'connection-1')).rejects.toBeInstanceOf(
      PartnerAiPortalError,
    )
    expect(harness.databaseClientProvider.getClient).not.toHaveBeenCalled()
  })

  it('revokes the grant and every token atomically with bounded audit metadata', async () => {
    const harness = buildHarness()

    const result = await harness.service.revoke(principal(), 'connection-1')

    expect(harness.connectionUpdateMany).toHaveBeenCalledWith({
      data: { activeGrantKey: null, revokedAt: now },
      where: { id: 'connection-1', revokedAt: null },
    })
    expect(harness.accessUpdateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { connectionId: 'connection-1', revokedAt: null },
    })
    expect(harness.refreshUpdateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { connectionId: 'connection-1', revokedAt: null },
    })
    expect(harness.auditRecord).toHaveBeenCalledWith({
      action: 'AI_CONNECTION_REVOKED',
      actorUserId: 'portal-user-1',
      metadata: {
        clientKind: PartnerAiClientKind.GENERIC,
        outcome: 'REVOKED',
        source: 'PARTNER_PORTAL',
      },
      partnerId: 'partner-1',
      resourceId: 'connection-1',
      resourceType: 'AI_CONNECTION',
    }, expect.anything())
    expect(JSON.stringify(harness.auditRecord.mock.calls)).not.toContain('Operations Assistant')
    expect(result.status).toBe('REVOKED')
  })

  it('makes repeated revocation idempotent without a duplicate audit event', async () => {
    const harness = buildHarness([connectionRecord({ activeGrantKey: null, revokedAt: now })])

    await expect(harness.service.revoke(principal(), 'connection-1')).resolves.toEqual(
      expect.objectContaining({ status: 'REVOKED' }),
    )
    expect(harness.transaction).not.toHaveBeenCalled()
    expect(harness.auditRecord).not.toHaveBeenCalled()
  })
})
