import 'reflect-metadata'

import type { Partner, PartnerPortalUser, PrismaClient } from '@prisma/client'

import { PartnerPortalRole } from '@prisma/client'

import { PartnerPortalAccountService, PartnerPortalAccountValidationError, PartnerPortalAuthenticationError } from '../../../../modules/partners/application/PartnerPortalAccountService'
import { PartnerPortalPasswordService } from '../../../../modules/partners/application/PartnerPortalPasswordService'
import { PartnerPortalSessionService } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type PasswordServiceMock = Pick<
  PartnerPortalPasswordService,
  'buildVerifier' | 'performDummyVerification' | 'verify'
>
type SessionServiceMock = Pick<PartnerPortalSessionService, 'createMfaChallenge'>
  & Pick<PartnerPortalSessionService, 'createSession'>

const partner = {
  apiKey: null,
  clientDomain: null,
  clientDomainHash: null,
  country: 'US',
  createdAt: new Date('2026-07-31T12:00:00.000Z'),
  email: 'partner@decaf.so',
  firstName: 'Decaf',
  id: '11111111-1111-4111-8111-111111111111',
  isKybApproved: true,
  lastName: 'Operations',
  name: 'Decaf',
  needsKyc: false,
  phone: null,
  previousApiKey: null,
  previousApiKeyExpiresAt: null,
  webhookUrl: 'https://api-v3.production.decafapi.com/abroad/webhook',
} satisfies Partner

const portalUser: PartnerPortalUser = {
  createdAt: new Date('2026-07-31T12:00:00.000Z'),
  disabledAt: null,
  email: 'operator@decaf.so',
  failedLoginAttempts: 0,
  id: '22222222-2222-4222-8222-222222222222',
  lastLoginAt: null,
  lockedUntil: null,
  mfaEnabledAt: null,
  mfaFailedAttempts: 0,
  mfaLastUsedCounter: null,
  mfaLockedUntil: null,
  mfaPendingCreatedAt: null,
  mfaPendingSecretCiphertext: null,
  mfaSecretCiphertext: null,
  partnerId: partner.id,
  passwordVerifier: 'stored-verifier',
  role: PartnerPortalRole.ADMIN,
  sessionVersion: 1,
  updatedAt: new Date('2026-07-31T12:00:00.000Z'),
}

type PartnerFindUniqueInput = { where: { id: string } }

type PortalUserCreateInput = {
  data: {
    email: string
    partnerId: string
    passwordVerifier: string
    role: PartnerPortalRole
  }
}
type PortalUserFindUniqueInput = {
  include?: { partner: true }
  where: { email: string }
}
type PortalUserUpdateInput = {
  data: Record<string, unknown>
  include?: { partner: true }
  select?: { failedLoginAttempts: true }
  where: { id: string }
}
type PortalUserUpdateManyInput = {
  data: {
    failedLoginAttempts: number
    lockedUntil: null
  }
  where: {
    id: string
    lockedUntil: { lte: Date }
  }
}
type PortalUserWithPartner = PartnerPortalUser & { partner: Partner }

const portalUserWithPartner: PortalUserWithPartner = { ...portalUser, partner }

const buildPasswordService = (): jest.Mocked<PasswordServiceMock> => {
  const buildVerifier = jest.fn<
    ReturnType<PartnerPortalPasswordService['buildVerifier']>,
    Parameters<PartnerPortalPasswordService['buildVerifier']>
  >()
  buildVerifier.mockResolvedValue('new-verifier')
  const performDummyVerification = jest.fn<
    ReturnType<PartnerPortalPasswordService['performDummyVerification']>,
    Parameters<PartnerPortalPasswordService['performDummyVerification']>
  >()
  performDummyVerification.mockResolvedValue(undefined)
  const verify = jest.fn<
    ReturnType<PartnerPortalPasswordService['verify']>,
    Parameters<PartnerPortalPasswordService['verify']>
  >()
  verify.mockResolvedValue(true)

  return { buildVerifier, performDummyVerification, verify }
}

const buildSessionService = (): jest.Mocked<SessionServiceMock> => {
  const createMfaChallenge = jest.fn<
    ReturnType<PartnerPortalSessionService['createMfaChallenge']>,
    Parameters<PartnerPortalSessionService['createMfaChallenge']>
  >()
  createMfaChallenge.mockResolvedValue({
    challengeToken: 'mfa-challenge-token',
    expiresAt: new Date('2026-07-31T12:05:00.000Z'),
  })
  const createSession = jest.fn<
    ReturnType<PartnerPortalSessionService['createSession']>,
    Parameters<PartnerPortalSessionService['createSession']>
  >()
  createSession.mockResolvedValue({
    accessToken: 'portal-token',
    email: portalUser.email,
    expiresAt: new Date('2026-07-31T12:30:00.000Z'),
    mfaEnabled: false,
    mfaVerified: false,
    partnerName: 'Decaf',
    role: PartnerPortalRole.ADMIN,
    userId: portalUser.id,
  })
  return { createMfaChallenge, createSession }
}

const buildHarness = () => {
  const partnerFindUnique = jest.fn<Promise<null | Partner>, [PartnerFindUniqueInput]>(
    async () => partner,
  )
  const portalUserCreate = jest.fn<Promise<PartnerPortalUser>, [PortalUserCreateInput]>(async () => ({
    ...portalUser,
    passwordVerifier: 'new-verifier',
  }))
  const portalUserFindUnique = jest.fn<
    Promise<null | PortalUserWithPartner>,
    [PortalUserFindUniqueInput]
  >(async () => portalUserWithPartner)
  const portalUserUpdate = jest.fn<
    Promise<PortalUserWithPartner>,
    [PortalUserUpdateInput]
  >(async () => portalUserWithPartner)
  const portalUserUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [PortalUserUpdateManyInput]
  >(async () => ({ count: 1 }))
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      partner: { findUnique: partnerFindUnique },
      partnerPortalUser: {
        create: portalUserCreate,
        findUnique: portalUserFindUnique,
        update: portalUserUpdate,
        updateMany: portalUserUpdateMany,
      },
    }) as unknown as PrismaClient),
  }
  const passwordService = buildPasswordService()
  const sessionService = buildSessionService()

  return {
    partnerFindUnique,
    passwordService,
    portalUserCreate,
    portalUserFindUnique,
    portalUserUpdate,
    portalUserUpdateMany,
    service: new PartnerPortalAccountService(
      databaseClientProvider,
      passwordService as unknown as PartnerPortalPasswordService,
      sessionService as unknown as PartnerPortalSessionService,
    ),
    sessionService,
  }
}

describe('PartnerPortalAccountService', () => {
  it('authenticates a normalized email and resets the failure state', async () => {
    const harness = buildHarness()

    const result = await harness.service.authenticate({
      email: ' Operator@Decaf.So ',
      password: 'correct horse battery staple',
    })

    expect(harness.portalUserFindUnique).toHaveBeenCalledWith({
      include: { partner: true },
      where: { email: 'operator@decaf.so' },
    })
    expect(harness.passwordService.verify).toHaveBeenCalledWith(
      'correct horse battery staple',
      'stored-verifier',
    )
    expect(harness.portalUserUpdate).toHaveBeenCalledWith({
      data: {
        failedLoginAttempts: 0,
        lastLoginAt: expect.any(Date),
        lockedUntil: null,
      },
      include: { partner: true },
      where: { id: portalUser.id },
    })
    expect(harness.sessionService.createSession).toHaveBeenCalledWith(portalUserWithPartner)
    expect(result).toEqual(expect.objectContaining({
      session: expect.objectContaining({ accessToken: 'portal-token' }),
      status: 'AUTHENTICATED',
    }))
  })

  it('performs dummy work and returns the generic error for an unknown email', async () => {
    const harness = buildHarness()
    harness.portalUserFindUnique.mockResolvedValueOnce(null)

    await expect(harness.service.authenticate({
      email: 'missing@decaf.so',
      password: 'incorrect portal password',
    })).rejects.toThrow(new PartnerPortalAuthenticationError())

    expect(harness.passwordService.performDummyVerification).toHaveBeenCalledWith(
      'incorrect portal password',
    )
    expect(harness.passwordService.verify).not.toHaveBeenCalled()
    expect(harness.portalUserUpdate).not.toHaveBeenCalled()
  })

  it('returns a short-lived MFA challenge instead of a session for an enrolled user', async () => {
    const harness = buildHarness()
    const enrolledUser = {
      ...portalUserWithPartner,
      mfaEnabledAt: new Date('2026-07-31T12:00:00.000Z'),
      mfaSecretCiphertext: 'active-envelope',
    }
    harness.portalUserFindUnique.mockResolvedValueOnce(enrolledUser)
    harness.portalUserUpdate.mockResolvedValueOnce(enrolledUser)

    const result = await harness.service.authenticate({
      email: portalUser.email,
      password: 'correct horse battery staple',
    })

    expect(result).toEqual({
      challenge: {
        challengeToken: 'mfa-challenge-token',
        expiresAt: new Date('2026-07-31T12:05:00.000Z'),
      },
      status: 'MFA_REQUIRED',
    })
    expect(harness.sessionService.createMfaChallenge).toHaveBeenCalledWith(enrolledUser)
    expect(harness.sessionService.createSession).not.toHaveBeenCalled()
  })

  it('locks the account for fifteen minutes on the fifth failed attempt', async () => {
    const harness = buildHarness()
    harness.portalUserFindUnique.mockResolvedValueOnce({
      ...portalUserWithPartner,
      failedLoginAttempts: 4,
    })
    harness.passwordService.verify.mockResolvedValueOnce(false)
    harness.portalUserUpdate
      .mockResolvedValueOnce({ ...portalUserWithPartner, failedLoginAttempts: 5 })
      .mockResolvedValueOnce({
        ...portalUserWithPartner,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 15 * 60 * 1_000),
      })

    await expect(harness.service.authenticate({
      email: portalUser.email,
      password: 'incorrect portal password',
    })).rejects.toThrow(new PartnerPortalAuthenticationError())

    expect(harness.portalUserUpdate).toHaveBeenNthCalledWith(1, {
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
      where: { id: portalUser.id },
    })
    expect(harness.portalUserUpdate).toHaveBeenNthCalledWith(2, {
      data: { lockedUntil: expect.any(Date) },
      where: { id: portalUser.id },
    })
    const updateInput = harness.portalUserUpdate.mock.calls[1][0]
    const lockedUntil = updateInput.data.lockedUntil
    expect(lockedUntil).toBeInstanceOf(Date)
    expect((lockedUntil as Date).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1_000)
  })

  it('resets an expired lock before atomically counting a new failure', async () => {
    const harness = buildHarness()
    const expiredAt = new Date(Date.now() - 60_000)
    harness.portalUserFindUnique.mockResolvedValueOnce({
      ...portalUserWithPartner,
      failedLoginAttempts: 5,
      lockedUntil: expiredAt,
    })
    harness.passwordService.verify.mockResolvedValueOnce(false)
    harness.portalUserUpdate.mockResolvedValueOnce({
      ...portalUserWithPartner,
      failedLoginAttempts: 1,
    })

    await expect(harness.service.authenticate({
      email: portalUser.email,
      password: 'incorrect portal password',
    })).rejects.toThrow(new PartnerPortalAuthenticationError())

    expect(harness.portalUserUpdateMany).toHaveBeenCalledWith({
      data: { failedLoginAttempts: 0, lockedUntil: null },
      where: {
        id: portalUser.id,
        lockedUntil: { lte: expect.any(Date) },
      },
    })
    expect(harness.portalUserUpdate).toHaveBeenCalledWith({
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
      where: { id: portalUser.id },
    })
  })

  it('checks the password but does not create a session for locked or disabled users', async () => {
    const harness = buildHarness()
    harness.portalUserFindUnique.mockResolvedValueOnce({
      ...portalUserWithPartner,
      lockedUntil: new Date(Date.now() + 60_000),
    })

    await expect(harness.service.authenticate({
      email: portalUser.email,
      password: 'correct horse battery staple',
    })).rejects.toThrow(new PartnerPortalAuthenticationError())

    expect(harness.passwordService.verify).toHaveBeenCalled()
    expect(harness.sessionService.createSession).not.toHaveBeenCalled()
    expect(harness.portalUserUpdate).not.toHaveBeenCalled()
  })

  it('creates a new portal user with only a password verifier persisted', async () => {
    const harness = buildHarness()
    harness.portalUserFindUnique.mockResolvedValueOnce(null)

    const result = await harness.service.provision(partner.id, {
      email: ' Operator@Decaf.So ',
      password: 'correct horse battery staple',
    })

    expect(harness.passwordService.buildVerifier).toHaveBeenCalledWith(
      'correct horse battery staple',
    )
    expect(harness.portalUserCreate).toHaveBeenCalledWith({
      data: {
        email: 'operator@decaf.so',
        partnerId: partner.id,
        passwordVerifier: 'new-verifier',
        role: PartnerPortalRole.ADMIN,
      },
    })
    expect(result).toEqual({
      created: true,
      email: portalUser.email,
      id: portalUser.id,
      partnerId: partner.id,
    })
    expect(JSON.stringify(result)).not.toContain('correct horse battery staple')
    expect(JSON.stringify(result)).not.toContain('new-verifier')
  })

  it('resets an existing account and invalidates its active sessions', async () => {
    const harness = buildHarness()
    harness.portalUserUpdate.mockResolvedValueOnce({
      ...portalUser,
      partner,
      passwordVerifier: 'new-verifier',
      sessionVersion: 2,
    })

    const result = await harness.service.provision(partner.id, {
      email: portalUser.email,
      password: 'new correct portal password',
    })

    expect(harness.portalUserUpdate).toHaveBeenCalledWith({
      data: {
        disabledAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordVerifier: 'new-verifier',
        role: PartnerPortalRole.ADMIN,
        sessionVersion: { increment: 1 },
      },
      where: { id: portalUser.id },
    })
    expect(result.created).toBe(false)
  })

  it('does not allow an email to move between partner tenants', async () => {
    const harness = buildHarness()
    harness.portalUserFindUnique.mockResolvedValueOnce({
      ...portalUserWithPartner,
      partnerId: '33333333-3333-4333-8333-333333333333',
    })

    await expect(harness.service.provision(partner.id, {
      email: portalUser.email,
      password: 'correct horse battery staple',
    })).rejects.toThrow(new PartnerPortalAccountValidationError(
      'Portal email is already assigned',
    ))

    expect(harness.portalUserCreate).not.toHaveBeenCalled()
    expect(harness.portalUserUpdate).not.toHaveBeenCalled()
  })
})
