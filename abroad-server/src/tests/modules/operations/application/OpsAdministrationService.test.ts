import type { OpsAuditEvent, OpsUser, Prisma, PrismaClient } from '@prisma/client'

import { OpsActorKind, OpsRole, Prisma as PrismaNamespace } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsAdministrationConflictError, OpsAdministrationService, OpsAdministrationValidationError } from '../../../../modules/operations/application/OpsAdministrationService'

const buildUser = (overrides: Partial<OpsUser> = {}): OpsUser => ({
  createdAt: new Date('2026-08-02T14:00:00.000Z'),
  disabledAt: null,
  displayName: 'Ana Operator',
  email: 'ana@abroad.finance',
  firebaseUid: 'firebase-user-1',
  id: 'ops-user-1',
  lastLoginAt: new Date('2026-08-02T15:00:00.000Z'),
  role: OpsRole.OPERATIONS,
  sessionsRevokedAt: null,
  sessionVersion: 2,
  updatedAt: new Date('2026-08-02T15:00:00.000Z'),
  version: 4,
  ...overrides,
})

const buildHarness = (user = buildUser()) => {
  const updated = buildUser({
    ...user,
    sessionVersion: user.sessionVersion + 1,
    updatedAt: new Date('2026-08-02T16:00:00.000Z'),
    version: user.version + 1,
  })
  const opsUser = {
    count: jest.fn().mockResolvedValue(2),
    create: jest.fn().mockResolvedValue(user),
    findMany: jest.fn().mockResolvedValue([user]),
    findUnique: jest.fn()
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(updated),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  }
  const opsAuditEvent = {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
  }
  const transaction = { opsUser } as unknown as Prisma.TransactionClient
  const prismaClient = {
    $transaction: jest.fn(async (
      operation: (client: Prisma.TransactionClient) => Promise<unknown>,
    ) => operation(transaction)),
    opsAuditEvent,
    opsUser,
  } as unknown as PrismaClient
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn().mockResolvedValue(prismaClient),
  }

  return {
    opsAuditEvent,
    opsUser,
    prismaClient,
    service: new OpsAdministrationService(provider),
    updated,
    user,
  }
}

describe('OpsAdministrationService', () => {
  it('lists named users with effective permissions and admission status', async () => {
    const active = buildUser()
    const invited = buildUser({
      email: 'support@abroad.finance',
      firebaseUid: null,
      id: 'ops-user-2',
      role: OpsRole.SUPPORT,
    })
    const disabled = buildUser({
      disabledAt: new Date('2026-08-02T17:00:00.000Z'),
      email: 'finance@abroad.finance',
      id: 'ops-user-3',
      role: OpsRole.FINANCE,
    })
    const harness = buildHarness()
    harness.opsUser.findMany.mockResolvedValueOnce([active, invited, disabled])

    const result = await harness.service.listUsers()

    expect(result.items).toEqual([
      expect.objectContaining({
        permissions: expect.arrayContaining(['flows:recover']),
        status: 'ACTIVE',
      }),
      expect.objectContaining({
        permissions: expect.arrayContaining(['transactions:proof']),
        status: 'INVITED',
      }),
      expect.objectContaining({ status: 'DISABLED' }),
    ])
  })

  it('invites only organization accounts without assigning a Firebase identity', async () => {
    const invited = buildUser({ firebaseUid: null, role: OpsRole.SUPPORT })
    const harness = buildHarness(invited)

    const result = await harness.service.inviteUser({
      displayName: 'Support Operator',
      email: 'SUPPORT@abroad.finance',
      role: OpsRole.SUPPORT,
    })

    expect(harness.opsUser.create).toHaveBeenCalledWith({
      data: {
        displayName: 'Support Operator',
        email: 'support@abroad.finance',
        role: OpsRole.SUPPORT,
      },
    })
    expect(result.status).toBe('INVITED')
    await expect(harness.service.inviteUser({
      displayName: 'Outside User',
      email: 'user@example.com',
      role: OpsRole.VIEWER,
    })).rejects.toBeInstanceOf(OpsAdministrationValidationError)
  })

  it('updates a role only at the expected version and revokes existing sessions', async () => {
    const harness = buildHarness()

    const result = await harness.service.updateRole(
      harness.user.id,
      OpsRole.SUPPORT,
      harness.user.version,
    )

    expect(harness.opsUser.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: OpsRole.SUPPORT,
        sessionsRevokedAt: expect.any(Date),
        sessionVersion: { increment: 1 },
        version: { increment: 1 },
      }),
      where: { id: harness.user.id, version: harness.user.version },
    })
    expect(result.version).toBe(harness.user.version + 1)
    expect(harness.prismaClient.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable },
    )
  })

  it('rejects stale edits, self-disable, and removal of the last administrator', async () => {
    const staleHarness = buildHarness()
    await expect(staleHarness.service.revokeSessions(
      staleHarness.user.id,
      staleHarness.user.version - 1,
    )).rejects.toBeInstanceOf(OpsAdministrationConflictError)
    expect(staleHarness.opsUser.updateMany).not.toHaveBeenCalled()

    const selfHarness = buildHarness()
    await expect(selfHarness.service.disableUser(
      selfHarness.user.id,
      selfHarness.user.version,
      selfHarness.user.id,
    )).rejects.toBeInstanceOf(OpsAdministrationValidationError)

    const administrator = buildUser({ role: OpsRole.ADMINISTRATOR })
    const lastAdminHarness = buildHarness(administrator)
    lastAdminHarness.opsUser.count.mockResolvedValueOnce(1)
    await expect(lastAdminHarness.service.updateRole(
      administrator.id,
      OpsRole.VIEWER,
      administrator.version,
    )).rejects.toBeInstanceOf(OpsAdministrationValidationError)
  })

  it('returns a filtered audit page with structured values minimized', async () => {
    const harness = buildHarness()
    const event: OpsAuditEvent = {
      action: 'configuration.asset.update.succeeded',
      actorKind: OpsActorKind.USER,
      actorLabel: 'Ana Operator',
      actorUserId: harness.user.id,
      createdAt: new Date('2026-08-02T17:00:00.000Z'),
      id: 'audit-1',
      metadata: {
        approvalClass: 'STEP_UP',
        expectedVersion: 4,
        nested: { secret: 'not returned' },
      },
      reason: 'Enable verified issuer',
      reference: 'OPS-123',
      resourceId: 'USDC:STELLAR',
      resourceType: 'crypto_asset',
    }
    harness.opsAuditEvent.findMany.mockResolvedValueOnce([event])
    harness.opsAuditEvent.count.mockResolvedValueOnce(1)

    const result = await harness.service.listAuditEvents({
      action: 'asset',
      actor: 'Ana',
      createdFrom: new Date('2026-08-01T00:00:00.000Z'),
      page: 1,
      pageSize: 50,
      resourceType: 'crypto',
    })

    expect(harness.opsAuditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 0,
      take: 50,
      where: expect.objectContaining({
        action: { contains: 'asset', mode: 'insensitive' },
        actorLabel: { contains: 'Ana', mode: 'insensitive' },
      }),
    }))
    expect(result.items[0]?.metadata).toEqual({
      approvalClass: 'STEP_UP',
      expectedVersion: 4,
      nested: '[structured]',
    })
  })
})
