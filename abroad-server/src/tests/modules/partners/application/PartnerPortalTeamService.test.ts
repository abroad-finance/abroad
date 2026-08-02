import 'reflect-metadata'

import type { PartnerPortalUser, PrismaClient } from '@prisma/client'

import { PartnerPortalPasswordResetPurpose, PartnerPortalRole, Prisma } from '@prisma/client'

import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalPrincipal } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { PartnerPortalTeamNotFoundError, PartnerPortalTeamService, PartnerPortalTeamValidationError } from '../../../../modules/partners/application/PartnerPortalTeamService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const principal: PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL',
  email: 'admin@decaf.so',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner: { id: 'partner-1', name: 'Decaf' } as PartnerPortalPrincipal['partner'],
  role: PartnerPortalRole.ADMIN,
  userId: 'admin-1',
}

const portalUser = (overrides: Partial<PartnerPortalUser> = {}): PartnerPortalUser => ({
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  disabledAt: null,
  email: 'member@decaf.so',
  emailVerificationRequiredAt: null,
  emailVerifiedAt: null,
  failedLoginAttempts: 0,
  id: 'member-1',
  lastLoginAt: null,
  lockedUntil: null,
  mfaEnabledAt: new Date('2026-08-01T12:00:00.000Z'),
  mfaFailedAttempts: 0,
  mfaLastUsedCounter: 1n,
  mfaLockedUntil: null,
  mfaPendingCreatedAt: null,
  mfaPendingSecretCiphertext: null,
  mfaSecretCiphertext: 'mfa-envelope',
  partnerId: principal.partner.id,
  passwordVerifier: 'password-verifier',
  role: PartnerPortalRole.MEMBER,
  sessionVersion: 1,
  updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  ...overrides,
})

const buildHarness = () => {
  const createUser = jest.fn(async () => portalUser())
  const findFirstUser = jest.fn<Promise<null | PartnerPortalUser>, [unknown]>(
    async () => portalUser(),
  )
  const findManyUsers = jest.fn(async () => [portalUser()])
  const updateUser = jest.fn(async (input: { data: Record<string, unknown> }) => portalUser({
    disabledAt: input.data.disabledAt instanceof Date ? input.data.disabledAt : null,
    role: input.data.role as PartnerPortalRole | undefined,
  }))
  const countUsers = jest.fn(async () => 2)
  const createResetToken = jest.fn<
    Promise<{ id: string }>,
    [{ data: Record<string, unknown> }]
  >(async () => ({ id: 'reset-token-1' }))
  const updateManyResetTokens = jest.fn(async () => ({ count: 1 }))
  const deleteManyRecoveryCodes = jest.fn(async () => ({ count: 10 }))
  const transactionClient = {
    partnerPortalMfaRecoveryCode: { deleteMany: deleteManyRecoveryCodes },
    partnerPortalPasswordResetToken: {
      create: createResetToken,
      updateMany: updateManyResetTokens,
    },
    partnerPortalUser: {
      count: countUsers,
      create: createUser,
      findFirst: findFirstUser,
      update: updateUser,
    },
  }
  const databaseTransaction = jest.fn<Promise<unknown>, [TransactionCallback]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const auditFindMany = jest.fn(async () => [{
    action: 'api_key.created',
    actor: { email: principal.email },
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    id: 'audit-1',
    resourceId: 'resource-1',
    resourceType: 'api_key',
  }])
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      $transaction: databaseTransaction,
      partnerPortalAuditEvent: { findMany: auditFindMany },
      partnerPortalUser: { findMany: findManyUsers },
    }) as unknown as PrismaClient),
  }
  const auditRecord = jest.fn(async () => undefined)
  return {
    auditFindMany,
    auditRecord,
    countUsers,
    createResetToken,
    createUser,
    databaseTransaction,
    deleteManyRecoveryCodes,
    findFirstUser,
    findManyUsers,
    service: new PartnerPortalTeamService(
      databaseClientProvider,
      { record: auditRecord } as unknown as PartnerPortalAuditService,
    ),
    updateManyResetTokens,
    updateUser,
  }
}

describe('PartnerPortalTeamService', () => {
  it('creates a tenant-owned individual account and reveals only a one-time setup token', async () => {
    const harness = buildHarness()

    const result = await harness.service.createUser(principal, {
      email: ' Member@Decaf.So ',
      role: PartnerPortalRole.MEMBER,
    })

    expect(harness.createUser).toHaveBeenCalledWith({
      data: {
        email: 'member@decaf.so',
        partnerId: principal.partner.id,
        role: PartnerPortalRole.MEMBER,
      },
    })
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(result.purpose).toBe(PartnerPortalPasswordResetPurpose.INVITATION)
    const persistedToken = harness.createResetToken.mock.calls[0][0]
    expect(persistedToken.data.tokenHash).not.toBe(result.token)
    expect(JSON.stringify(persistedToken)).not.toContain(result.token)
    expect(result.user).not.toHaveProperty('passwordVerifier')
  })

  it('maps a globally duplicate portal email to a bounded validation error', async () => {
    const harness = buildHarness()
    harness.databaseTransaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        clientVersion: 'test',
        code: 'P2002',
      }),
    )

    await expect(harness.service.createUser(principal, {
      email: 'member@decaf.so',
      role: PartnerPortalRole.MEMBER,
    })).rejects.toThrow('Portal email is already assigned')
  })

  it('lists users and audit events only through the requested tenant filter', async () => {
    const harness = buildHarness()

    const [users, auditEvents] = await Promise.all([
      harness.service.listUsers(principal.partner.id),
      harness.service.listAuditEvents(principal.partner.id, 500),
    ])

    expect(harness.findManyUsers).toHaveBeenCalledWith(expect.objectContaining({
      where: { partnerId: principal.partner.id },
    }))
    expect(harness.auditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      where: { partnerId: principal.partner.id },
    }))
    expect(users[0]).toEqual(expect.objectContaining({
      email: 'member@decaf.so',
      mfaEnabled: true,
      role: PartnerPortalRole.MEMBER,
    }))
    expect(auditEvents[0]).toEqual(expect.objectContaining({
      actorEmail: principal.email,
    }))
  })

  it('prevents self-demotion and the removal of the last active administrator', async () => {
    const selfHarness = buildHarness()
    selfHarness.findFirstUser.mockResolvedValueOnce(portalUser({
      email: principal.email,
      id: principal.userId,
      role: PartnerPortalRole.ADMIN,
    }))

    await expect(selfHarness.service.updateUser(
      principal,
      principal.userId,
      { role: PartnerPortalRole.MEMBER },
    )).rejects.toThrow('You cannot disable or remove your own administrator access')

    const lastAdminHarness = buildHarness()
    lastAdminHarness.findFirstUser.mockResolvedValueOnce(portalUser({
      id: 'other-admin',
      role: PartnerPortalRole.ADMIN,
    }))
    lastAdminHarness.countUsers.mockResolvedValueOnce(1)
    await expect(lastAdminHarness.service.updateUser(
      principal,
      'other-admin',
      { disabled: true },
    )).rejects.toThrow('At least one active administrator is required')
    expect(lastAdminHarness.updateUser).not.toHaveBeenCalled()
  })

  it('updates a tenant-owned account and invalidates its existing sessions', async () => {
    const harness = buildHarness()

    await harness.service.updateUser(
      principal,
      'member-1',
      { disabled: true, role: PartnerPortalRole.ADMIN },
    )

    expect(harness.findFirstUser).toHaveBeenCalledWith({
      where: { id: 'member-1', partnerId: principal.partner.id },
    })
    expect(harness.updateUser).toHaveBeenCalledWith({
      data: {
        disabledAt: expect.any(Date),
        failedLoginAttempts: undefined,
        lockedUntil: undefined,
        role: PartnerPortalRole.ADMIN,
        sessionVersion: { increment: 1 },
      },
      where: { id: 'member-1' },
    })
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.user_updated' }),
      expect.anything(),
    )
  })

  it('issues one reset token for an enabled tenant user and revokes prior tokens', async () => {
    const harness = buildHarness()

    const result = await harness.service.issuePasswordReset(principal, 'member-1')

    expect(harness.updateManyResetTokens).toHaveBeenCalledWith({
      data: { consumedAt: expect.any(Date) },
      where: { consumedAt: null, userId: 'member-1' },
    })
    expect(result.purpose).toBe(PartnerPortalPasswordResetPurpose.PASSWORD_RESET)
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  })

  it('does not issue reset tokens for disabled or cross-tenant users', async () => {
    const disabledHarness = buildHarness()
    disabledHarness.findFirstUser.mockResolvedValueOnce(portalUser({ disabledAt: new Date() }))
    await expect(disabledHarness.service.issuePasswordReset(
      principal,
      'member-1',
    )).rejects.toThrow('Enable the portal user before issuing a password reset')
    expect(disabledHarness.createResetToken).not.toHaveBeenCalled()

    const missingHarness = buildHarness()
    missingHarness.findFirstUser.mockResolvedValueOnce(null)
    await expect(missingHarness.service.issuePasswordReset(
      principal,
      'other-tenant-user',
    )).rejects.toThrow(new PartnerPortalTeamNotFoundError())
  })

  it('requires another administrator for MFA reset and invalidates the target sessions', async () => {
    const selfHarness = buildHarness()
    await expect(selfHarness.service.resetMfa(
      principal,
      principal.userId,
    )).rejects.toThrow(new PartnerPortalTeamValidationError(
      'Another administrator must reset your MFA factor',
    ))

    const harness = buildHarness()
    await harness.service.resetMfa(principal, 'member-1')

    expect(harness.deleteManyRecoveryCodes).toHaveBeenCalledWith({
      where: { userId: 'member-1' },
    })
    expect(harness.updateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mfaEnabledAt: null,
        mfaSecretCiphertext: null,
        sessionVersion: { increment: 1 },
      }),
      where: { id: 'member-1' },
    })
  })
})
