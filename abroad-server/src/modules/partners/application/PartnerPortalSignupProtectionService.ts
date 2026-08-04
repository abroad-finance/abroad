import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import jwt from 'jsonwebtoken'
import { createHmac, randomBytes } from 'node:crypto'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'

const CHALLENGE_AUDIENCE = 'abroad-partner-signup'
const CHALLENGE_ISSUER = 'https://api.abroad.finance/partner-portal/signup'
const CHALLENGE_MINIMUM_DWELL_MS = 1_500
const CHALLENGE_TOKEN_USE = 'partner_portal_public_signup'
const CHALLENGE_TTL_SECONDS = 15 * 60
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1_000
const MAX_SERIALIZATION_ATTEMPTS = 3
const MINIMUM_SIGNING_SECRET_BYTES = 32
const ONE_HOUR_MS = 60 * 60 * 1_000

export type PartnerPortalSignupChallenge = {
  challengeToken: string
  expiresAt: Date
  // Durations let the caller wait out the dwell without comparing our clock to
  // its own; the absolute stamps stay for display and debugging only.
  expiresInMs: number
  readyAt: Date
  readyInMs: number
}

type ChallengePayload = jwt.JwtPayload & {
  issuedAtMs: number
  nonce: string
  tokenUse: typeof CHALLENGE_TOKEN_USE
}

type RateLimitRule = {
  context: string
  identifier: string
  limit: number
  windowMs: number
}

type RateLimitState = {
  attempts: number
  context: string
  limit: number
  windowEndsAt: Date
}

export class PartnerPortalSignupProtectionError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalSignupProtectionError'
  }
}

export class PartnerPortalSignupRateLimitError extends Error {
  public constructor(public readonly retryAfterSeconds: number) {
    super('Signup is temporarily unavailable. Try again later.')
    this.name = 'PartnerPortalSignupRateLimitError'
  }
}

@injectable()
export class PartnerPortalSignupProtectionService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
    @inject(TYPES.ISecretManager)
    private readonly secretManager: ISecretManager,
  ) {}

  public async assertResendAllowed(input: {
    challengeToken: string
    clientIp: string
    email: string
    honeypot: string
  }): Promise<void> {
    await this.consumeRateLimits([
      { context: 'resend-ip', identifier: input.clientIp, limit: 10, windowMs: ONE_HOUR_MS },
      { context: 'resend-email', identifier: input.email, limit: 5, windowMs: ONE_HOUR_MS },
    ])
    if (input.honeypot.trim().length > 0) {
      throw new PartnerPortalSignupProtectionError('Signup request could not be verified')
    }
    await this.verifyChallenge(input.challengeToken)
  }

  public async assertSignupAllowed(input: {
    challengeToken: string
    clientIp: string
    email: string
    honeypot: string
    organization: string
  }): Promise<void> {
    await this.consumeRateLimits([
      { context: 'signup-ip', identifier: input.clientIp, limit: 5, windowMs: ONE_HOUR_MS },
      { context: 'signup-email', identifier: input.email, limit: 3, windowMs: ONE_HOUR_MS },
      { context: 'signup-organization', identifier: input.organization, limit: 3, windowMs: ONE_HOUR_MS },
    ])
    if (input.honeypot.trim().length > 0) {
      throw new PartnerPortalSignupProtectionError('Signup request could not be verified')
    }
    await this.verifyChallenge(input.challengeToken)
  }

  public async consumeEmailVerificationAttempt(clientIp: string): Promise<void> {
    await this.consumeRateLimits([
      { context: 'verify-ip', identifier: clientIp, limit: 30, windowMs: ONE_HOUR_MS },
    ])
  }

  public async createChallenge(clientIp: string): Promise<PartnerPortalSignupChallenge> {
    await this.consumeRateLimits([
      { context: 'challenge-ip', identifier: clientIp, limit: 30, windowMs: ONE_HOUR_MS },
    ])
    const signingSecret = await this.getSigningSecret()
    const issuedAtMs = Date.now()
    const challengeToken = jwt.sign(
      {
        issuedAtMs,
        nonce: randomBytes(16).toString('base64url'),
        tokenUse: CHALLENGE_TOKEN_USE,
      },
      signingSecret,
      {
        algorithm: 'HS256',
        audience: CHALLENGE_AUDIENCE,
        expiresIn: CHALLENGE_TTL_SECONDS,
        issuer: CHALLENGE_ISSUER,
      },
    )
    return {
      challengeToken,
      expiresAt: new Date(issuedAtMs + CHALLENGE_TTL_SECONDS * 1_000),
      expiresInMs: CHALLENGE_TTL_SECONDS * 1_000,
      readyAt: new Date(issuedAtMs + CHALLENGE_MINIMUM_DWELL_MS),
      readyInMs: CHALLENGE_MINIMUM_DWELL_MS,
    }
  }

  public async hashIdentifier(context: string, identifier: string): Promise<string> {
    const signingSecret = await this.getSigningSecret()
    return createHmac('sha256', signingSecret)
      .update(`partner-portal-signup:${context}:`, 'utf8')
      .update(identifier, 'utf8')
      .digest('base64url')
  }

  private async consumeRateLimits(rules: readonly RateLimitRule[]): Promise<void> {
    const now = new Date()
    const hashedRules = await Promise.all(rules.map(async rule => ({
      ...rule,
      keyHash: await this.hashIdentifier(rule.context, rule.identifier),
    })))
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.partnerPortalPublicRateLimit.deleteMany({
      where: { windowEndsAt: { lt: new Date(now.getTime() - CLEANUP_RETENTION_MS) } },
    })

    let states: null | RateLimitState[] = null
    for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        states = await prismaClient.$transaction(async (transaction) => {
          const nextStates: RateLimitState[] = []
          for (const rule of hashedRules) {
            const existing = await transaction.partnerPortalPublicRateLimit.findUnique({
              where: { keyHash: rule.keyHash },
            })
            const current = !existing
              ? await transaction.partnerPortalPublicRateLimit.create({
                  data: {
                    attempts: 1,
                    keyHash: rule.keyHash,
                    windowEndsAt: new Date(now.getTime() + rule.windowMs),
                  },
                })
              : existing.windowEndsAt <= now
                ? await transaction.partnerPortalPublicRateLimit.update({
                    data: {
                      attempts: 1,
                      windowEndsAt: new Date(now.getTime() + rule.windowMs),
                    },
                    where: { keyHash: rule.keyHash },
                  })
                : await transaction.partnerPortalPublicRateLimit.update({
                    data: { attempts: { increment: 1 } },
                    where: { keyHash: rule.keyHash },
                  })
            nextStates.push({
              attempts: current.attempts,
              context: rule.context,
              limit: rule.limit,
              windowEndsAt: current.windowEndsAt,
            })
          }
          return nextStates
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        break
      }
      catch (error) {
        if (!this.isRetryableSerializationError(error) || attempt === MAX_SERIALIZATION_ATTEMPTS) {
          throw error
        }
      }
    }

    if (!states) {
      throw new Error('Public signup rate-limit state was not recorded')
    }
    const exceeded = states.filter(state => state.attempts > state.limit)
    if (exceeded.length > 0) {
      const retryAfterSeconds = Math.max(...exceeded.map(state => (
        Math.max(1, Math.ceil((state.windowEndsAt.getTime() - now.getTime()) / 1_000))
      )))
      this.logger.warn('[PartnerPortalSignup] Public signup rate limit exceeded', {
        exceeded: exceeded.map(state => ({
          attempts: state.attempts,
          context: state.context,
          limit: state.limit,
        })),
        retryAfterSeconds,
      })
      throw new PartnerPortalSignupRateLimitError(retryAfterSeconds)
    }
  }

  private async getSigningSecret(): Promise<string> {
    const signingSecret = await this.secretManager.getSecret('PARTNER_PORTAL_JWT_SECRET')
    if (Buffer.byteLength(signingSecret, 'utf8') < MINIMUM_SIGNING_SECRET_BYTES) {
      throw new Error('Partner portal signing secret is not configured securely')
    }
    return signingSecret
  }

  private isChallengePayload(payload: unknown): payload is ChallengePayload {
    return (
      typeof payload === 'object'
      && payload !== null
      && 'issuedAtMs' in payload
      && typeof payload.issuedAtMs === 'number'
      && Number.isSafeInteger(payload.issuedAtMs)
      && 'nonce' in payload
      && typeof payload.nonce === 'string'
      && payload.nonce.length >= 16
      && 'tokenUse' in payload
      && payload.tokenUse === CHALLENGE_TOKEN_USE
    )
  }

  private isRetryableSerializationError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')
    )
  }

  private async verifyChallenge(challengeToken: string): Promise<void> {
    try {
      const signingSecret = await this.getSigningSecret()
      const payload = jwt.verify(challengeToken, signingSecret, {
        algorithms: ['HS256'],
        audience: CHALLENGE_AUDIENCE,
        issuer: CHALLENGE_ISSUER,
      })
      if (!this.isChallengePayload(payload)) {
        throw new Error('Invalid signup challenge payload')
      }
      const ageMs = Date.now() - payload.issuedAtMs
      if (ageMs < CHALLENGE_MINIMUM_DWELL_MS || ageMs > CHALLENGE_TTL_SECONDS * 1_000) {
        throw new Error(`Signup challenge timing is invalid (ageMs=${ageMs})`)
      }
    }
    catch (error) {
      this.logger.warn('[PartnerPortalSignup] Challenge verification failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      })
      throw new PartnerPortalSignupProtectionError('Signup request could not be verified')
    }
  }
}
