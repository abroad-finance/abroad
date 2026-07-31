import type { Partner, Prisma } from '@prisma/client'

import { inject, injectable } from 'inversify'
import jwt from 'jsonwebtoken'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'

const PORTAL_AUDIENCE = 'abroad-partner-portal'
const PORTAL_ISSUER = 'https://api.abroad.finance/partner-portal'
const PORTAL_SCOPE = 'transactions:read'
const PORTAL_TOKEN_USE = 'partner_portal'
const SESSION_TTL_SECONDS = 30 * 60
const MINIMUM_SIGNING_SECRET_BYTES = 32

export type PartnerPortalSession = {
  accessToken: string
  expiresAt: Date
  partnerName: string
}

interface PartnerPortalJwtPayload extends jwt.JwtPayload {
  scope: typeof PORTAL_SCOPE
  sessionVersion: number
  sub: string
  tokenUse: typeof PORTAL_TOKEN_USE
}

const portalUserWithPartner = {
  partner: true,
} satisfies Prisma.PartnerPortalUserInclude

export type PartnerPortalSessionUser = Prisma.PartnerPortalUserGetPayload<{
  include: typeof portalUserWithPartner
}>

@injectable()
export class PartnerPortalSessionService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager)
    private readonly secretManager: ISecretManager,
  ) {}

  public async createSession(portalUser: PartnerPortalSessionUser): Promise<PartnerPortalSession> {
    const signingSecret = await this.getSigningSecret()
    const issuedAtMs = Date.now()
    const accessToken = jwt.sign(
      {
        scope: PORTAL_SCOPE,
        sessionVersion: portalUser.sessionVersion,
        tokenUse: PORTAL_TOKEN_USE,
      },
      signingSecret,
      {
        algorithm: 'HS256',
        audience: PORTAL_AUDIENCE,
        expiresIn: SESSION_TTL_SECONDS,
        issuer: PORTAL_ISSUER,
        subject: portalUser.id,
      },
    )

    return {
      accessToken,
      expiresAt: new Date(issuedAtMs + SESSION_TTL_SECONDS * 1_000),
      partnerName: portalUser.partner.name,
    }
  }

  public async verifySession(accessToken: string): Promise<Partner> {
    try {
      const signingSecret = await this.getSigningSecret()
      const payload = jwt.verify(accessToken, signingSecret, {
        algorithms: ['HS256'],
        audience: PORTAL_AUDIENCE,
        issuer: PORTAL_ISSUER,
      })

      if (!this.isPartnerPortalPayload(payload)) {
        throw new Error('Invalid partner portal token payload')
      }

      const prismaClient = await this.databaseClientProvider.getClient()
      const portalUser = await prismaClient.partnerPortalUser.findUnique({
        include: portalUserWithPartner,
        where: { id: payload.sub },
      })
      if (
        !portalUser
        || portalUser.disabledAt
        || portalUser.sessionVersion !== payload.sessionVersion
      ) {
        throw new Error('Partner portal user not found')
      }

      return portalUser.partner
    }
    catch {
      throw new Error('Partner portal token verification failed')
    }
  }

  private async getSigningSecret(): Promise<string> {
    const signingSecret = await this.secretManager.getSecret('PARTNER_PORTAL_JWT_SECRET')
    if (Buffer.byteLength(signingSecret, 'utf8') < MINIMUM_SIGNING_SECRET_BYTES) {
      throw new Error('Partner portal signing secret is not configured securely')
    }
    return signingSecret
  }

  private isPartnerPortalPayload(payload: unknown): payload is PartnerPortalJwtPayload {
    return (
      typeof payload === 'object'
      && payload !== null
      && 'sub' in payload
      && typeof payload.sub === 'string'
      && payload.sub.trim().length > 0
      && 'scope' in payload
      && payload.scope === PORTAL_SCOPE
      && 'sessionVersion' in payload
      && typeof payload.sessionVersion === 'number'
      && Number.isSafeInteger(payload.sessionVersion)
      && payload.sessionVersion > 0
      && 'tokenUse' in payload
      && payload.tokenUse === PORTAL_TOKEN_USE
    )
  }
}
