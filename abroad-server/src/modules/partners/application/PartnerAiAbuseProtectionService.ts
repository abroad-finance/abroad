import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { createHmac } from 'node:crypto'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'

const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1_000
const MAX_SERIALIZATION_ATTEMPTS = 3
const ONE_HOUR_MS = 60 * 60 * 1_000

type RateLimitRule = {
  context: string
  identifier: string
  limit: number
  windowMs: number
}

type RateLimitState = {
  attempts: number
  limit: number
  windowEndsAt: Date
}

export class PartnerAiRateLimitError extends Error {
  public constructor(public readonly retryAfterSeconds: number) {
    super('AI connection requests are temporarily limited. Try again later.')
    this.name = 'PartnerAiRateLimitError'
  }
}

@injectable()
export class PartnerAiAbuseProtectionService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager)
    private readonly secretManager: ISecretManager,
  ) {}

  public async assertAuthorizationAllowed(clientIp: string, clientId: string): Promise<void> {
    await this.consume([
      { context: 'authorize-ip', identifier: this.normalizeIdentifier(clientIp), limit: 120, windowMs: ONE_HOUR_MS },
      { context: 'authorize-client', identifier: clientId, limit: 240, windowMs: ONE_HOUR_MS },
    ])
  }

  public async assertRegistrationAllowed(clientIp: string): Promise<void> {
    await this.consume([
      { context: 'register-ip', identifier: this.normalizeIdentifier(clientIp), limit: 30, windowMs: ONE_HOUR_MS },
    ])
  }

  public async assertTokenRequestAllowed(clientIp: string, clientId: string): Promise<void> {
    await this.consume([
      { context: 'token-ip', identifier: this.normalizeIdentifier(clientIp), limit: 300, windowMs: ONE_HOUR_MS },
      { context: 'token-client', identifier: clientId, limit: 600, windowMs: ONE_HOUR_MS },
    ])
  }

  public async assertToolCallAllowed(connectionId: string, partnerId: string): Promise<void> {
    await this.consume([
      { context: 'tool-connection', identifier: connectionId, limit: 600, windowMs: ONE_HOUR_MS },
      { context: 'tool-partner', identifier: partnerId, limit: 1_200, windowMs: ONE_HOUR_MS },
    ])
  }

  private async consume(rules: readonly RateLimitRule[]): Promise<void> {
    const now = new Date()
    const keySecret = await this.secretManager.getSecret('PARTNER_PORTAL_JWT_SECRET')
    const hashedRules = rules.map(rule => ({
      ...rule,
      keyHash: createHmac('sha256', keySecret)
        .update(`partner-ai:${rule.context}:`, 'utf8')
        .update(rule.identifier, 'utf8')
        .digest('base64url'),
    }))
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

    if (!states) throw new Error('AI integration rate-limit state was not recorded')
    const exceeded = states.filter(state => state.attempts > state.limit)
    if (exceeded.length > 0) {
      throw new PartnerAiRateLimitError(Math.max(...exceeded.map(state => (
        Math.max(1, Math.ceil((state.windowEndsAt.getTime() - now.getTime()) / 1_000))
      ))))
    }
  }

  private isRetryableSerializationError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')
  }

  private normalizeIdentifier(identifier: string): string {
    const normalized = identifier.trim()
    return normalized || 'unknown'
  }
}
