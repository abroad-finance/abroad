import 'reflect-metadata'

import type { Partner, PrismaClient } from '@prisma/client'

import jwt from 'jsonwebtoken'

import { PartnerPortalSessionService } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

const signingSecret = 'p'.repeat(64)
const partner = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Decaf',
} as Partner

const buildService = (options: {
  foundPartner?: null | Partner
  secret?: string
} = {}) => {
  const findUnique = jest.fn(async () => options.foundPartner === undefined ? partner : options.foundPartner)
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({ partner: { findUnique } }) as unknown as PrismaClient),
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
  it('creates a scoped short-lived token and verifies the active partner', async () => {
    const { findUnique, service } = buildService()

    const session = await service.createSession(partner)
    const verifiedPartner = await service.verifySession(session.accessToken)
    const decoded = jwt.decode(session.accessToken)

    expect(session.partnerName).toBe('Decaf')
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(decoded).toEqual(expect.objectContaining({
      aud: 'abroad-partner-portal',
      iss: 'https://api.abroad.finance/partner-portal',
      scope: 'transactions:read',
      sub: partner.id,
      tokenUse: 'partner_portal',
    }))
    expect(findUnique).toHaveBeenCalledWith({ where: { id: partner.id } })
    expect(verifiedPartner).toBe(partner)
  })

  it('rejects a validly signed token without the portal scope', async () => {
    const { service } = buildService()
    const token = jwt.sign(
      { scope: 'transactions:write', tokenUse: 'partner_portal' },
      signingSecret,
      {
        algorithm: 'HS256',
        audience: 'abroad-partner-portal',
        issuer: 'https://api.abroad.finance/partner-portal',
        subject: partner.id,
      },
    )

    await expect(service.verifySession(token)).rejects.toThrow(
      'Partner portal token verification failed',
    )
  })

  it('rejects a token after its partner no longer exists', async () => {
    const creator = buildService().service
    const token = (await creator.createSession(partner)).accessToken
    const verifier = buildService({ foundPartner: null }).service

    await expect(verifier.verifySession(token)).rejects.toThrow(
      'Partner portal token verification failed',
    )
  })

  it('refuses a signing secret shorter than 32 bytes', async () => {
    const { service } = buildService({ secret: 'too-short' })

    await expect(service.createSession(partner)).rejects.toThrow(
      'Partner portal signing secret is not configured securely',
    )
  })
})
