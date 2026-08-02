import 'reflect-metadata'

import type { Partner, PartnerPortalUser, PrismaClient } from '@prisma/client'

import { PartnerPortalPasswordResetPurpose, PartnerPortalRole, Prisma } from '@prisma/client'

import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalIdentityAuthenticationError, PartnerPortalIdentityService } from '../../../../modules/partners/application/PartnerPortalIdentityService'
import { PartnerPortalMfaService, PartnerPortalMfaValidationError } from '../../../../modules/partners/application/PartnerPortalMfaService'
import { PartnerPortalPasswordService } from '../../../../modules/partners/application/PartnerPortalPasswordService'
import { PartnerPortalSecretEnvelopeService } from '../../../../modules/partners/application/PartnerPortalSecretEnvelopeService'
import { PartnerPortalPrincipal, PartnerPortalSessionService, PartnerPortalSessionUser } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const partner = {
  id: 'partner-1',
  name: 'Decaf',
} as Partner

const portalUser = (
  overrides: Partial<PartnerPortalUser> = {},
): PartnerPortalSessionUser => ({
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  disabledAt: null,
  email: 'admin@decaf.so',
  emailVerificationRequiredAt: null,
  emailVerifiedAt: null,
  failedLoginAttempts: 0,
  id: 'user-1',
  lastLoginAt: null,
  lockedUntil: null,
  mfaEnabledAt: new Date('2026-08-01T12:00:00.000Z'),
  mfaFailedAttempts: 0,
  mfaLastUsedCounter: 10n,
  mfaLockedUntil: null,
  mfaPendingCreatedAt: new Date(),
  mfaPendingSecretCiphertext: 'pending-envelope',
  mfaSecretCiphertext: 'active-envelope',
  partner,
  partnerId: partner.id,
  passwordVerifier: 'stored-verifier',
  role: PartnerPortalRole.ADMIN,
  sessionVersion: 2,
  updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  ...overrides,
})

const principal: PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL',
  email: 'admin@decaf.so',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner,
  role: PartnerPortalRole.ADMIN,
  userId: 'user-1',
}

const portalSession = {
  accessToken: 'portal-session-token',
  email: principal.email,
  expiresAt: new Date('2026-08-01T12:30:00.000Z'),
  mfaEnabled: true,
  mfaVerified: true,
  partnerName: partner.name,
  role: PartnerPortalRole.ADMIN,
  userId: principal.userId,
}

const recoveryCodes = [
  { codeHash: 'hash-1', plaintext: 'AAAA-BBBB-CCCC-DDDD' },
  { codeHash: 'hash-2', plaintext: 'EEEE-FFFF-GGGG-HHHH' },
]

const buildHarness = (storedUser: PartnerPortalSessionUser = portalUser()) => {
  const findUniqueUser = jest.fn<Promise<null | PartnerPortalSessionUser>, [unknown]>(
    async () => storedUser,
  )
  const updateManyUser = jest.fn(async () => ({ count: 1 }))
  const updateUser = jest.fn<Promise<{ mfaFailedAttempts: number }>, [unknown]>(
    async () => ({ mfaFailedAttempts: 1 }),
  )
  const transactionUpdateUser = jest.fn(async () => ({
    ...storedUser,
    sessionVersion: storedUser.sessionVersion + 1,
  }))
  const createManyRecoveryCodes = jest.fn(async () => ({ count: recoveryCodes.length }))
  const deleteManyRecoveryCodes = jest.fn(async () => ({ count: recoveryCodes.length }))
  const consumeRecoveryCode = jest.fn(async () => ({ count: 1 }))
  const consumeResetToken = jest.fn(async () => ({ count: 1 }))
  const transactionClient = {
    partnerPortalMfaRecoveryCode: {
      createMany: createManyRecoveryCodes,
      deleteMany: deleteManyRecoveryCodes,
      updateMany: consumeRecoveryCode,
    },
    partnerPortalPasswordResetToken: { updateMany: consumeResetToken },
    partnerPortalUser: {
      update: transactionUpdateUser,
      updateMany: updateManyUser,
    },
  }
  const databaseTransaction = jest.fn<Promise<unknown>, [TransactionCallback]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const findUniqueResetToken = jest.fn(async () => ({
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    id: 'reset-token-1',
    purpose: PartnerPortalPasswordResetPurpose.PASSWORD_RESET,
    user: storedUser,
    userId: storedUser.id,
  }))
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      $transaction: databaseTransaction,
      partnerPortalMfaRecoveryCode: { updateMany: consumeRecoveryCode },
      partnerPortalPasswordResetToken: { findUnique: findUniqueResetToken },
      partnerPortalUser: {
        findUnique: findUniqueUser,
        update: updateUser,
        updateMany: updateManyUser,
      },
    }) as unknown as PrismaClient),
  }
  const auditRecord = jest.fn(async () => undefined)
  const buildEnrollment = jest.fn(() => ({
    manualEntryKey: 'ABCD EFGH',
    otpauthUri: 'otpauth://totp/Abroad%3ADecaf?secret=ABCDEFGH',
    secret: 'ABCDEFGH',
  }))
  const generateRecoveryCodes = jest.fn(() => recoveryCodes)
  const hashRecoveryCode = jest.fn(() => 'recovery-hash')
  const verifyTotp = jest.fn(() => 11n)
  const buildVerifier = jest.fn(async () => 'new-verifier')
  const verifyPassword = jest.fn(async () => true)
  const decrypt = jest.fn(async (_envelope: string, context: string) => (
    context.endsWith(':pending') ? 'pending-secret' : 'active-secret'
  ))
  const encrypt = jest.fn(async () => 'encrypted-envelope')
  const createSession = jest.fn(async () => portalSession)
  const verifyMfaChallenge = jest.fn(async () => storedUser)

  return {
    auditRecord,
    buildEnrollment,
    buildVerifier,
    consumeRecoveryCode,
    consumeResetToken,
    createManyRecoveryCodes,
    createSession,
    databaseTransaction,
    decrypt,
    deleteManyRecoveryCodes,
    encrypt,
    findUniqueResetToken,
    findUniqueUser,
    generateRecoveryCodes,
    hashRecoveryCode,
    service: new PartnerPortalIdentityService(
      databaseClientProvider,
      { record: auditRecord } as unknown as PartnerPortalAuditService,
      {
        buildEnrollment,
        generateRecoveryCodes,
        hashRecoveryCode,
        verifyTotp,
      } as unknown as PartnerPortalMfaService,
      {
        buildVerifier,
        verify: verifyPassword,
      } as unknown as PartnerPortalPasswordService,
      { decrypt, encrypt } as unknown as PartnerPortalSecretEnvelopeService,
      {
        createSession,
        verifyMfaChallenge,
      } as unknown as PartnerPortalSessionService,
    ),
    transactionUpdateUser,
    updateManyUser,
    updateUser,
    verifyMfaChallenge,
    verifyPassword,
    verifyTotp,
  }
}

describe('PartnerPortalIdentityService', () => {
  it('reauthenticates and stores only an encrypted pending MFA enrollment', async () => {
    const harness = buildHarness(portalUser({
      mfaEnabledAt: null,
      mfaSecretCiphertext: null,
    }))

    const result = await harness.service.beginMfaEnrollment(
      { ...principal, mfaEnabled: false, mfaVerified: false },
      'current-password',
    )

    expect(harness.verifyPassword).toHaveBeenCalledWith(
      'current-password',
      'stored-verifier',
    )
    expect(harness.buildEnrollment).toHaveBeenCalledWith(principal.email, partner.name)
    expect(harness.encrypt).toHaveBeenCalledWith(
      'ABCDEFGH',
      'partner-portal:mfa:user-1:pending',
    )
    expect(harness.transactionUpdateUser).toHaveBeenCalledWith({
      data: {
        mfaPendingCreatedAt: expect.any(Date),
        mfaPendingSecretCiphertext: 'encrypted-envelope',
      },
      where: { id: principal.userId },
    })
    expect(result).toEqual(expect.objectContaining({
      manualEntryKey: 'ABCD EFGH',
      otpauthUri: expect.stringMatching(/^otpauth:/u),
    }))
    expect(JSON.stringify(harness.transactionUpdateUser.mock.calls)).not.toContain('ABCDEFGH')
  })

  it('confirms enrollment, replaces recovery codes, and invalidates prior sessions', async () => {
    const harness = buildHarness()

    const result = await harness.service.confirmMfaEnrollment(principal, '123456')

    expect(harness.decrypt).toHaveBeenCalledWith(
      'pending-envelope',
      'partner-portal:mfa:user-1:pending',
    )
    expect(harness.verifyTotp).toHaveBeenCalledWith(
      'pending-secret',
      '123456',
      null,
      expect.any(Date),
    )
    expect(harness.createManyRecoveryCodes).toHaveBeenCalledWith({
      data: recoveryCodes.map(code => ({ codeHash: code.codeHash, userId: principal.userId })),
    })
    expect(harness.transactionUpdateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mfaEnabledAt: expect.any(Date),
        mfaLastUsedCounter: 11n,
        mfaSecretCiphertext: 'encrypted-envelope',
        sessionVersion: { increment: 1 },
      }),
      include: { partner: true },
      where: { id: principal.userId },
    })
    expect(result.recoveryCodes).toEqual(recoveryCodes.map(code => code.plaintext))
    expect(result.session.accessToken).toBe(portalSession.accessToken)
  })

  it('maps invalid MFA challenge tokens to the generic authentication error', async () => {
    const harness = buildHarness()
    harness.verifyMfaChallenge.mockRejectedValueOnce(new Error('JWT details'))

    await expect(harness.service.completeMfaChallenge(
      'invalid-challenge',
      '123456',
    )).rejects.toThrow(new PartnerPortalIdentityAuthenticationError())
    expect(harness.verifyTotp).not.toHaveBeenCalled()
  })

  it('accepts a replay-safe TOTP and creates an MFA-verified session', async () => {
    const harness = buildHarness()

    const result = await harness.service.completeMfaChallenge(
      'valid-challenge',
      '123456',
    )

    expect(harness.verifyTotp).toHaveBeenCalledWith(
      'active-secret',
      '123456',
      10n,
      expect.any(Date),
    )
    expect(harness.updateManyUser).toHaveBeenCalledWith({
      data: {
        mfaFailedAttempts: 0,
        mfaLastUsedCounter: 11n,
        mfaLockedUntil: null,
      },
      where: {
        AND: [
          {
            OR: [
              { mfaLastUsedCounter: null },
              { mfaLastUsedCounter: { lt: 11n } },
            ],
          },
          {
            OR: [
              { mfaLockedUntil: null },
              { mfaLockedUntil: { lte: expect.any(Date) } },
            ],
          },
        ],
        id: principal.userId,
      },
    })
    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({
      id: principal.userId,
    }), true)
    expect(result.mfaVerified).toBe(true)
  })

  it('consumes a recovery code and resets the MFA failure state atomically', async () => {
    const harness = buildHarness()

    await harness.service.completeMfaChallenge(
      'valid-challenge',
      'AAAA-BBBB-CCCC-DDDD',
    )

    expect(harness.hashRecoveryCode).toHaveBeenCalledWith('AAAA-BBBB-CCCC-DDDD')
    expect(harness.updateManyUser).toHaveBeenCalledWith({
      data: { mfaFailedAttempts: 0, mfaLockedUntil: null },
      where: {
        id: principal.userId,
        OR: [
          { mfaLockedUntil: null },
          { mfaLockedUntil: { lte: expect.any(Date) } },
        ],
      },
    })
    expect(harness.consumeRecoveryCode).toHaveBeenCalledWith({
      data: { consumedAt: expect.any(Date) },
      where: {
        codeHash: 'recovery-hash',
        consumedAt: null,
        userId: principal.userId,
      },
    })
    expect(harness.transactionUpdateUser).not.toHaveBeenCalled()
  })

  it('records invalid factor attempts and locks on the fifth failure', async () => {
    const harness = buildHarness(portalUser({ mfaFailedAttempts: 4 }))
    harness.verifyTotp.mockImplementationOnce(() => {
      throw new PartnerPortalMfaValidationError('Authentication code is invalid')
    })
    harness.transactionUpdateUser.mockResolvedValueOnce(portalUser({ mfaFailedAttempts: 5 }))

    await expect(harness.service.completeMfaChallenge(
      'valid-challenge',
      '000000',
    )).rejects.toThrow(new PartnerPortalIdentityAuthenticationError())
    expect(harness.transactionUpdateUser).toHaveBeenNthCalledWith(1, {
      data: { mfaFailedAttempts: { increment: 1 } },
      select: { mfaFailedAttempts: true },
      where: { id: principal.userId },
    })
    expect(harness.transactionUpdateUser).toHaveBeenNthCalledWith(2, {
      data: { mfaLockedUntil: expect.any(Date) },
      where: { id: principal.userId },
    })
  })

  it('changes passwords and consumes recovery reset codes with session invalidation', async () => {
    const changeHarness = buildHarness()
    await changeHarness.service.changePassword(
      principal,
      'current-password',
      'new-password-value',
    )
    expect(changeHarness.buildVerifier).toHaveBeenCalledWith('new-password-value')
    expect(changeHarness.transactionUpdateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        passwordVerifier: 'new-verifier',
        sessionVersion: { increment: 1 },
      }),
      where: { id: principal.userId },
    })

    const recoveryHarness = buildHarness()
    await recoveryHarness.service.resetPasswordWithRecoveryCode(
      principal.email,
      'AAAA-BBBB-CCCC-DDDD',
      'new-password-value',
    )
    expect(recoveryHarness.consumeRecoveryCode).toHaveBeenCalledWith({
      data: { consumedAt: expect.any(Date) },
      where: {
        codeHash: 'recovery-hash',
        consumedAt: null,
        userId: principal.userId,
      },
    })
    expect(recoveryHarness.transactionUpdateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        passwordVerifier: 'new-verifier',
        sessionVersion: { increment: 1 },
      }),
      where: { id: principal.userId },
    })
  })

  it('consumes a valid reset token once and rejects expired links generically', async () => {
    const harness = buildHarness()

    await harness.service.resetPasswordWithToken(
      'a'.repeat(43),
      'new-password-value',
    )

    expect(harness.consumeResetToken).toHaveBeenCalledWith({
      data: { consumedAt: expect.any(Date) },
      where: {
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
        id: 'reset-token-1',
      },
    })
    expect(harness.transactionUpdateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        passwordVerifier: 'new-verifier',
        sessionVersion: { increment: 1 },
      }),
      where: { id: principal.userId },
    })

    const expiredHarness = buildHarness()
    expiredHarness.findUniqueResetToken.mockResolvedValueOnce({
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1),
      id: 'reset-token-1',
      purpose: PartnerPortalPasswordResetPurpose.PASSWORD_RESET,
      user: portalUser(),
      userId: principal.userId,
    })
    await expect(expiredHarness.service.resetPasswordWithToken(
      'b'.repeat(43),
      'new-password-value',
    )).rejects.toThrow('Reset link is invalid or expired')
    expect(expiredHarness.databaseTransaction).not.toHaveBeenCalled()
  })
})
