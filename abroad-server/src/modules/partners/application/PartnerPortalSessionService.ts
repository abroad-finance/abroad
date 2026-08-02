import type { Partner, PartnerPortalRole, Prisma } from '@prisma/client'

import { inject, injectable } from 'inversify'
import jwt from 'jsonwebtoken'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'

const MFA_CHALLENGE_TOKEN_USE = 'partner_portal_mfa_challenge'
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60
const MINIMUM_SIGNING_SECRET_BYTES = 32
const PORTAL_AUDIENCE = 'abroad-partner-portal'
const PORTAL_ISSUER = 'https://api.abroad.finance/partner-portal'
const PORTAL_SCOPE = 'transactions:read'
const PORTAL_TOKEN_USE = 'partner_portal'
const SESSION_TTL_SECONDS = 30 * 60

export type PartnerPortalMfaChallenge = {
  challengeToken: string
  expiresAt: Date
}

export type PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL'
  email: string
  kind: 'partner_portal'
  mfaEnabled: boolean
  mfaVerified: boolean
  partner: Partner
  role: PartnerPortalRole
  userId: string
}

export type PartnerPortalSession = {
  accessToken: string
  email: string
  expiresAt: Date
  mfaEnabled: boolean
  mfaVerified: boolean
  partnerName: string
  role: PartnerPortalRole
  userId: string
}

interface PartnerPortalJwtPayload extends jwt.JwtPayload {
  mfaVerified: boolean
  role: PartnerPortalRole
  scope: typeof PORTAL_SCOPE
  sessionVersion: number
  sub: string
  tokenUse: typeof PORTAL_TOKEN_USE
}

interface PartnerPortalMfaChallengePayload extends jwt.JwtPayload {
  sessionVersion: number
  sub: string
  tokenUse: typeof MFA_CHALLENGE_TOKEN_USE
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

  public async createMfaChallenge(
    portalUser: PartnerPortalSessionUser,
  ): Promise<PartnerPortalMfaChallenge> {
    this.assertEmailVerificationComplete(portalUser)
    const signingSecret = await this.getSigningSecret()
    const issuedAtMs = Date.now()
    const challengeToken = jwt.sign(
      {
        sessionVersion: portalUser.sessionVersion,
        tokenUse: MFA_CHALLENGE_TOKEN_USE,
      },
      signingSecret,
      {
        algorithm: 'HS256',
        audience: PORTAL_AUDIENCE,
        expiresIn: MFA_CHALLENGE_TTL_SECONDS,
        issuer: PORTAL_ISSUER,
        subject: portalUser.id,
      },
    )
    return {
      challengeToken,
      expiresAt: new Date(issuedAtMs + MFA_CHALLENGE_TTL_SECONDS * 1_000),
    }
  }

  public async createSession(
    portalUser: PartnerPortalSessionUser,
    mfaVerified = false,
  ): Promise<PartnerPortalSession> {
    this.assertEmailVerificationComplete(portalUser)
    if (mfaVerified && !portalUser.mfaEnabledAt) {
      throw new Error('MFA cannot be verified for a user without an enrolled factor')
    }

    const signingSecret = await this.getSigningSecret()
    const issuedAtMs = Date.now()
    const accessToken = jwt.sign(
      {
        mfaVerified,
        role: portalUser.role,
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
      email: portalUser.email,
      expiresAt: new Date(issuedAtMs + SESSION_TTL_SECONDS * 1_000),
      mfaEnabled: Boolean(portalUser.mfaEnabledAt),
      mfaVerified,
      partnerName: portalUser.partner.name,
      role: portalUser.role,
      userId: portalUser.id,
    }
  }

  public async verifyMfaChallenge(
    challengeToken: string,
  ): Promise<PartnerPortalSessionUser> {
    try {
      const signingSecret = await this.getSigningSecret()
      const payload = jwt.verify(challengeToken, signingSecret, {
        algorithms: ['HS256'],
        audience: PORTAL_AUDIENCE,
        issuer: PORTAL_ISSUER,
      })
      if (!this.isMfaChallengePayload(payload)) {
        throw new Error('Invalid MFA challenge payload')
      }

      const portalUser = await this.findActivePortalUser(payload.sub, payload.sessionVersion)
      if (!portalUser.mfaEnabledAt || !portalUser.mfaSecretCiphertext) {
        throw new Error('MFA is not enrolled')
      }
      return portalUser
    }
    catch {
      throw new Error('Partner portal MFA challenge verification failed')
    }
  }

  public async verifySession(accessToken: string): Promise<PartnerPortalPrincipal> {
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

      const portalUser = await this.findActivePortalUser(payload.sub, payload.sessionVersion)
      if (portalUser.role !== payload.role) {
        throw new Error('Partner portal role changed')
      }
      const mfaEnabled = Boolean(portalUser.mfaEnabledAt && portalUser.mfaSecretCiphertext)
      if (payload.mfaVerified && !mfaEnabled) {
        throw new Error('Partner portal MFA state changed')
      }

      return {
        authenticationSource: 'PARTNER_PORTAL',
        email: portalUser.email,
        kind: 'partner_portal',
        mfaEnabled,
        mfaVerified: payload.mfaVerified,
        partner: portalUser.partner,
        role: portalUser.role,
        userId: portalUser.id,
      }
    }
    catch {
      throw new Error('Partner portal token verification failed')
    }
  }

  private assertEmailVerificationComplete(portalUser: PartnerPortalSessionUser): void {
    if (portalUser.emailVerificationRequiredAt && !portalUser.emailVerifiedAt) {
      throw new Error('Partner portal email verification is required')
    }
  }

  private async findActivePortalUser(
    userId: string,
    sessionVersion: number,
  ): Promise<PartnerPortalSessionUser> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const portalUser = await prismaClient.partnerPortalUser.findUnique({
      include: portalUserWithPartner,
      where: { id: userId },
    })
    if (
      !portalUser
      || portalUser.disabledAt
      || (portalUser.emailVerificationRequiredAt && !portalUser.emailVerifiedAt)
      || portalUser.passwordVerifier === null
      || portalUser.sessionVersion !== sessionVersion
    ) {
      throw new Error('Partner portal user not found')
    }
    return portalUser
  }

  private async getSigningSecret(): Promise<string> {
    const signingSecret = await this.secretManager.getSecret('PARTNER_PORTAL_JWT_SECRET')
    if (Buffer.byteLength(signingSecret, 'utf8') < MINIMUM_SIGNING_SECRET_BYTES) {
      throw new Error('Partner portal signing secret is not configured securely')
    }
    return signingSecret
  }

  private hasBasePayload(
    payload: unknown,
  ): payload is { sessionVersion: number, sub: string } {
    return (
      typeof payload === 'object'
      && payload !== null
      && 'sub' in payload
      && typeof payload.sub === 'string'
      && payload.sub.trim().length > 0
      && 'sessionVersion' in payload
      && typeof payload.sessionVersion === 'number'
      && Number.isSafeInteger(payload.sessionVersion)
      && payload.sessionVersion > 0
    )
  }

  private isMfaChallengePayload(
    payload: unknown,
  ): payload is PartnerPortalMfaChallengePayload {
    return (
      this.hasBasePayload(payload)
      && 'tokenUse' in payload
      && payload.tokenUse === MFA_CHALLENGE_TOKEN_USE
    )
  }

  private isPartnerPortalPayload(payload: unknown): payload is PartnerPortalJwtPayload {
    return (
      this.hasBasePayload(payload)
      && 'scope' in payload
      && payload.scope === PORTAL_SCOPE
      && 'tokenUse' in payload
      && payload.tokenUse === PORTAL_TOKEN_USE
      && 'role' in payload
      && (payload.role === 'ADMIN' || payload.role === 'MEMBER')
      && 'mfaVerified' in payload
      && typeof payload.mfaVerified === 'boolean'
    )
  }
}
