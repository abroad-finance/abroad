import 'reflect-metadata'

import type { Partner, PartnerPortalUser, PrismaClient } from '@prisma/client'

import jwt from 'jsonwebtoken'

import { PartnerPortalSessionService, PartnerPortalSessionUser } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

const signingSecret = 'p'.repeat(64)
const partner = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Decaf',
} as Partner
const portalUser = {
  createdAt: new Date('2026-07-31T12:00:00.000Z'),
  disabledAt: null,
  email: 'operator@decaf.so',
  failedLoginAttempts: 0,
  id: '22222222-2222-4222-8222-222222222222',
  lastLoginAt: null,
  lockedUntil: null,
  partner,
  partnerId: partner.id,
  passwordVerifier: 'not-used-by-session-tests',
  sessionVersion: 3,
  updatedAt: new Date('2026-07-31T12:00:00.000Z'),
} satisfies PartnerPortalUser & { partner: Partner }

const buildService = (options: {
  foundUser?: null | PartnerPortalSessionUser
  secret?: string
} = {}) => {
  const findUnique = jest.fn(async () => (
    options.foundUser === undefined ? portalUser : options.foundUser
  ))
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      partnerPortalUser: { findUnique },
    }) as unknown as PrismaClient),
  }
  const secretManager: ISecretManager = {
    getSecret: jest.fn(async () => options.secret ?? signingSecret),
    getSecrets: jest.fn(),
  }

  return {
    findUnique,
    secretManager,
    service: new PartnerPortalSessionService(databaseClientProvider, secretManager),
  }
}

describe('PartnerPortalSessionService', () => {
  it('creates a scoped short-lived token and verifies the active portal user', async () => {
    const { findUnique, service } = buildService()

    const session = await service.createSession(portalUser)
    const verifiedPartner = await service.verifySession(session.accessToken)
    const decoded = jwt.decode(session.accessToken)

    expect(session.partnerName).toBe('Decaf')
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(decoded).toEqual(expect.objectContaining({
      aud: 'abroad-partner-portal',
      iss: 'https://api.abroad.finance/partner-portal',
      scope: 'transactions:read',
      sessionVersion: 3,
      sub: portalUser.id,
      tokenUse: 'partner_portal',
    }))
    expect(findUnique).toHaveBeenCalledWith({
      include: { partner: true },
      where: { id: portalUser.id },
    })
    expect(verifiedPartner).toBe(partner)
  })

  it('rejects a validly signed token without the portal scope', async () => {
    const { service } = buildService()
    const token = jwt.sign(
      {
        scope: 'transactions:write',
        sessionVersion: portalUser.sessionVersion,
        tokenUse: 'partner_portal',
      },
      signingSecret,
      {
        algorithm: 'HS256',
        audience: 'abroad-partner-portal',
        issuer: 'https://api.abroad.finance/partner-portal',
        subject: portalUser.id,
      },
    )

    await expect(service.verifySession(token)).rejects.toThrow(
      'Partner portal token verification failed',
    )
  })

  it('rejects a token after password reset changes the session version', async () => {
    const creator = buildService().service
    const token = (await creator.createSession(portalUser)).accessToken
    const verifier = buildService({
      foundUser: { ...portalUser, sessionVersion: portalUser.sessionVersion + 1 },
    }).service

    await expect(verifier.verifySession(token)).rejects.toThrow(
      'Partner portal token verification failed',
    )
  })

  it('rejects a token after its portal user is disabled', async () => {
    const creator = buildService().service
    const token = (await creator.createSession(portalUser)).accessToken
    const verifier = buildService({
      foundUser: { ...portalUser, disabledAt: new Date('2026-07-31T12:10:00.000Z') },
    }).service

    await expect(verifier.verifySession(token)).rejects.toThrow(
      'Partner portal token verification failed',
    )
  })

  it('refuses a signing secret shorter than 32 bytes', async () => {
    const { service } = buildService({ secret: 'too-short' })

    await expect(service.createSession(portalUser)).rejects.toThrow(
      'Partner portal signing secret is not configured securely',
    )
  })
})
