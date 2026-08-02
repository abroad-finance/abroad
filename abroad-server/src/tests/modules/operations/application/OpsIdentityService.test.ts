import type { OpsUser, Prisma, PrismaClient } from '@prisma/client'

import { OpsRole, Prisma as PrismaNamespace } from '@prisma/client'

import type { IOpsIdentityProvider } from '../../../../modules/operations/application/contracts/IOpsIdentityProvider'
import type { OpsExternalIdentity } from '../../../../modules/operations/application/opsIdentity'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsAuditService } from '../../../../modules/operations/application/OpsAuditService'
import { OpsAuthenticationError } from '../../../../modules/operations/application/opsIdentity'
import { OpsBootstrapConflictError, OpsIdentityAdmissionError, OpsIdentityService } from '../../../../modules/operations/application/OpsIdentityService'

const identity: OpsExternalIdentity = {
  authTime: new Date('2026-08-02T15:00:00.000Z'),
  displayName: 'Ana Operator',
  email: 'ana@abroad.finance',
  provider: 'google.com',
  subject: 'firebase-user-1',
}

const user: OpsUser = {
  createdAt: new Date('2026-08-02T14:00:00.000Z'),
  disabledAt: null,
  displayName: identity.displayName,
  email: identity.email,
  firebaseUid: identity.subject,
  id: 'ops-user-1',
  lastLoginAt: identity.authTime,
  role: OpsRole.VIEWER,
  sessionsRevokedAt: null,
  sessionVersion: 1,
  updatedAt: new Date('2026-08-02T15:00:00.000Z'),
  version: 1,
}

type Harness = {
  auditRecord: jest.Mock
  identityProviderVerify: jest.Mock
  opsUser: OpsUserRepositoryMock
  service: OpsIdentityService
  transactionRunner: jest.Mock
}

type OpsUserRepositoryMock = {
  count: jest.Mock
  create: jest.Mock
  findUnique: jest.Mock
  update: jest.Mock
}

const buildHarness = (): Harness => {
  const opsUser: OpsUserRepositoryMock = {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue(user),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue(user),
  }
  const transaction = { opsUser } as unknown as Prisma.TransactionClient
  const transactionRunner = jest.fn(async (
    operation: (client: Prisma.TransactionClient) => Promise<unknown>,
  ) => operation(transaction))
  const prismaClient = {
    $transaction: transactionRunner,
    opsUser,
  } as unknown as PrismaClient
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn().mockResolvedValue(prismaClient),
  }
  const identityProviderVerify = jest.fn().mockResolvedValue(identity)
  const identityProvider: IOpsIdentityProvider = {
    verifyIdToken: identityProviderVerify,
  }
  const auditRecord = jest.fn().mockResolvedValue({})
  const auditService = { record: auditRecord } as unknown as OpsAuditService

  return {
    auditRecord,
    identityProviderVerify,
    opsUser,
    service: new OpsIdentityService(
      databaseClientProvider,
      identityProvider,
      auditService,
    ),
    transactionRunner,
  }
}

describe('OpsIdentityService', () => {
  it('admits a verified organization identity as a viewer and audits admission', async () => {
    const harness = buildHarness()
    harness.opsUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const session = await harness.service.admit(identity)

    expect(harness.opsUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: OpsRole.VIEWER }),
    })
    expect(harness.opsUser.count).toHaveBeenCalledWith({
      where: { disabledAt: null, role: OpsRole.ADMINISTRATOR },
    })
    expect(session.principal).toEqual(expect.objectContaining({
      email: identity.email,
      kind: 'ops_user',
      role: OpsRole.VIEWER,
      userId: user.id,
    }))
    expect(session.bootstrapRequired).toBe(true)
    expect(harness.auditRecord).toHaveBeenCalledWith(
      session.principal,
      expect.objectContaining({ action: 'identity.user_admitted' }),
      expect.objectContaining({ opsUser: harness.opsUser }),
    )
  })

  it('rejects identities outside the organization before database access', async () => {
    const harness = buildHarness()

    await expect(harness.service.admit({
      ...identity,
      email: 'ana@example.com',
    })).rejects.toBeInstanceOf(OpsIdentityAdmissionError)

    expect(harness.transactionRunner).not.toHaveBeenCalled()
  })

  it('rejects subject and email collisions during admission', async () => {
    const harness = buildHarness()
    harness.opsUser.findUnique.mockResolvedValueOnce({
      ...user,
      firebaseUid: 'different-subject',
    })

    await expect(harness.service.admit(identity)).rejects.toBeInstanceOf(
      OpsAuthenticationError,
    )
    expect(harness.opsUser.create).not.toHaveBeenCalled()
    expect(harness.opsUser.update).not.toHaveBeenCalled()
  })

  it('authenticates only an enabled admitted user with the same verified email', async () => {
    const harness = buildHarness()
    harness.opsUser.findUnique.mockResolvedValueOnce(user)

    await expect(harness.service.authenticate('firebase-token')).resolves.toEqual(
      expect.objectContaining({
        email: identity.email,
        permissions: expect.arrayContaining(['overview:read']),
        userId: user.id,
      }),
    )
    expect(harness.identityProviderVerify).toHaveBeenCalledWith('firebase-token')

    harness.opsUser.findUnique.mockResolvedValueOnce({
      ...user,
      disabledAt: new Date('2026-08-02T16:00:00.000Z'),
    })
    await expect(harness.service.authenticate('firebase-token')).rejects.toBeInstanceOf(
      OpsAuthenticationError,
    )
  })

  it('bootstraps the first administrator in a serializable transaction', async () => {
    const harness = buildHarness()
    const administrator = {
      ...user,
      role: OpsRole.ADMINISTRATOR,
      sessionVersion: 2,
    }
    harness.opsUser.count.mockResolvedValueOnce(0)
    harness.opsUser.findUnique.mockResolvedValueOnce(user)
    harness.opsUser.update.mockResolvedValueOnce(administrator)

    const session = await harness.service.bootstrapAdministrator(identity)

    expect(session.bootstrapRequired).toBe(false)
    expect(session.principal.role).toBe(OpsRole.ADMINISTRATOR)
    expect(session.principal.permissions).toContain('administration:users')
    expect(harness.transactionRunner).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable },
    )
    expect(harness.auditRecord).toHaveBeenCalledWith(
      session.principal,
      expect.objectContaining({ action: 'identity.administrator_bootstrapped' }),
      expect.objectContaining({ opsUser: harness.opsUser }),
    )
  })

  it('refuses bootstrap when an enabled administrator already exists', async () => {
    const harness = buildHarness()
    harness.opsUser.count.mockResolvedValueOnce(1)

    await expect(harness.service.bootstrapAdministrator(identity)).rejects.toBeInstanceOf(
      OpsBootstrapConflictError,
    )
    expect(harness.opsUser.create).not.toHaveBeenCalled()
    expect(harness.opsUser.update).not.toHaveBeenCalled()
  })

  it('claims an administrator-invited email without changing its assigned role', async () => {
    const harness = buildHarness()
    const invited = {
      ...user,
      firebaseUid: null,
      role: OpsRole.SUPPORT,
    }
    harness.opsUser.findUnique
      .mockResolvedValueOnce(invited)
      .mockResolvedValueOnce(null)
    harness.opsUser.update.mockResolvedValueOnce({
      ...invited,
      firebaseUid: identity.subject,
    })

    const session = await harness.service.admit(identity)

    expect(harness.opsUser.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ firebaseUid: identity.subject }),
      where: { id: invited.id },
    }))
    expect(session.principal.role).toBe(OpsRole.SUPPORT)
    expect(harness.opsUser.create).not.toHaveBeenCalled()
  })

  it('requires administrator admission after bootstrap and rejects revoked sessions', async () => {
    const harness = buildHarness()
    harness.opsUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    harness.opsUser.count.mockResolvedValueOnce(1)

    await expect(harness.service.admit(identity)).rejects.toBeInstanceOf(
      OpsIdentityAdmissionError,
    )

    harness.opsUser.findUnique.mockResolvedValueOnce({
      ...user,
      sessionsRevokedAt: identity.authTime,
    })
    await expect(harness.service.authenticate('revoked-token')).rejects.toBeInstanceOf(
      OpsAuthenticationError,
    )
  })
})
