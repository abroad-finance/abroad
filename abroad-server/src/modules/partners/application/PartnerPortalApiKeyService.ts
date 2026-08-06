import { PartnerApiKey, PartnerApiKeyScope, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { buildPartnerApiKeyCandidate } from './partnerApiKey'
import { fromDatabasePartnerApiKeyScope, isPartnerApiKeyScopeName, PartnerApiKeyScopeName, toDatabasePartnerApiKeyScope } from './partnerApiKeyScopes'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'
import { PartnerPortalPrincipal } from './PartnerPortalSessionService'

const API_KEY_RETRY_ATTEMPTS = 5
const MAX_EXPIRY_MS = 2 * 365 * 24 * 60 * 60 * 1_000
const MAX_NAME_LENGTH = 64
const MIN_EXPIRY_MS = 5 * 60 * 1_000
const ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1_000

type PartnerPortalApiKeyCreateInput = {
  expiresAt?: Date
  name: string
  scopes: readonly string[]
}

export type PartnerPortalApiKeyList = {
  items: PartnerPortalApiKeySummary[]
  legacyKeyActive: boolean
}

export type PartnerPortalApiKeySecretResult = {
  apiKey: PartnerPortalApiKeySummary
  secret: string
}

export type PartnerPortalApiKeySummary = {
  createdAt: Date
  displayPrefix: string
  expiresAt: Date | null
  id: string
  lastUsedAt: Date | null
  name: string
  revokedAt: Date | null
  scopes: PartnerApiKeyScopeName[]
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
}

export class PartnerPortalApiKeyNotFoundError extends Error {
  public constructor() {
    super('API key not found')
    this.name = 'PartnerPortalApiKeyNotFoundError'
  }
}

export class PartnerPortalApiKeyValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalApiKeyValidationError'
  }
}

@injectable()
export class PartnerPortalApiKeyService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
  ) {}

  public async create(
    principal: PartnerPortalPrincipal,
    input: PartnerPortalApiKeyCreateInput,
  ): Promise<PartnerPortalApiKeySecretResult> {
    const normalized = this.normalizeInput(input)
    const prismaClient = await this.databaseClientProvider.getClient()
    for (let attempt = 1; attempt <= API_KEY_RETRY_ATTEMPTS; attempt += 1) {
      const candidate = buildPartnerApiKeyCandidate()
      try {
        const created = await prismaClient.$transaction(async (transaction) => {
          const apiKey = await transaction.partnerApiKey.create({
            data: {
              createdByUserId: principal.userId,
              displayPrefix: candidate.displayPrefix,
              expiresAt: normalized.expiresAt,
              name: normalized.name,
              partnerId: principal.partner.id,
              scopes: normalized.scopes,
              secretHash: candidate.hashed,
            },
          })
          await this.auditService.record({
            action: 'api_key.created',
            actorUserId: principal.userId,
            metadata: {
              expires: Boolean(normalized.expiresAt),
              scopes: normalized.scopeNames,
            },
            partnerId: principal.partner.id,
            resourceId: apiKey.id,
            resourceType: 'api_key',
          }, transaction)
          return apiKey
        })
        return { apiKey: this.toSummary(created), secret: candidate.plaintext }
      }
      catch (error) {
        if (this.isUniqueConstraintError(error)) {
          if (attempt < API_KEY_RETRY_ATTEMPTS) {
            continue
          }
          break
        }
        throw error
      }
    }
    throw new PartnerPortalApiKeyValidationError('Could not generate a unique API key')
  }

  public async list(partnerId: string): Promise<PartnerPortalApiKeyList> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const [partner, keys] = await Promise.all([
      prismaClient.partner.findUnique({ select: { apiKey: true }, where: { id: partnerId } }),
      prismaClient.partnerApiKey.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { partnerId },
      }),
    ])
    return {
      items: keys.map(key => this.toSummary(key)),
      legacyKeyActive: Boolean(partner?.apiKey),
    }
  }

  public async revoke(
    principal: PartnerPortalPrincipal,
    apiKeyId: string,
  ): Promise<PartnerPortalApiKeySummary> {
    const prismaClient = await this.databaseClientProvider.getClient()
    return prismaClient.$transaction(async (transaction) => {
      const existing = await transaction.partnerApiKey.findFirst({
        where: { id: apiKeyId, partnerId: principal.partner.id },
      })
      if (!existing) {
        throw new PartnerPortalApiKeyNotFoundError()
      }
      const revoked = existing.revokedAt
        ? existing
        : await transaction.partnerApiKey.update({
            data: { revokedAt: new Date() },
            where: { id: apiKeyId },
          })
      if (!existing.revokedAt) {
        await this.auditService.record({
          action: 'api_key.revoked',
          actorUserId: principal.userId,
          partnerId: principal.partner.id,
          resourceId: apiKeyId,
          resourceType: 'api_key',
        }, transaction)
      }
      return this.toSummary(revoked)
    })
  }

  public async rotate(
    principal: PartnerPortalPrincipal,
    apiKeyId: string,
  ): Promise<PartnerPortalApiKeySecretResult> {
    const prismaClient = await this.databaseClientProvider.getClient()
    for (let attempt = 1; attempt <= API_KEY_RETRY_ATTEMPTS; attempt += 1) {
      const candidate = buildPartnerApiKeyCandidate()
      try {
        const successor = await prismaClient.$transaction(async (transaction) => {
          const existing = await transaction.partnerApiKey.findFirst({
            include: { rotatedTo: { select: { id: true } } },
            where: { id: apiKeyId, partnerId: principal.partner.id },
          })
          const now = new Date()
          if (
            !existing
            || existing.revokedAt
            || (existing.expiresAt && existing.expiresAt <= now)
          ) {
            throw new PartnerPortalApiKeyNotFoundError()
          }
          if (existing.rotatedTo) {
            throw new PartnerPortalApiKeyValidationError('API key has already been rotated')
          }

          const overlapExpiry = new Date(now.getTime() + ROTATION_OVERLAP_MS)
          await transaction.partnerApiKey.update({
            data: {
              expiresAt: existing.expiresAt && existing.expiresAt < overlapExpiry
                ? existing.expiresAt
                : overlapExpiry,
            },
            where: { id: existing.id },
          })
          const created = await transaction.partnerApiKey.create({
            data: {
              createdByUserId: principal.userId,
              displayPrefix: candidate.displayPrefix,
              expiresAt: existing.expiresAt,
              name: `${existing.name} (rotated)`.slice(0, MAX_NAME_LENGTH),
              partnerId: principal.partner.id,
              rotatedFromId: existing.id,
              scopes: existing.scopes,
              secretHash: candidate.hashed,
            },
          })
          await this.auditService.record({
            action: 'api_key.rotated',
            actorUserId: principal.userId,
            metadata: { overlapHours: ROTATION_OVERLAP_MS / 60 / 60 / 1_000 },
            partnerId: principal.partner.id,
            resourceId: created.id,
            resourceType: 'api_key',
          }, transaction)
          return created
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        return { apiKey: this.toSummary(successor), secret: candidate.plaintext }
      }
      catch (error) {
        if (this.isRetryableRotationError(error)) {
          const current = await prismaClient.partnerApiKey.findFirst({
            include: { rotatedTo: { select: { id: true } } },
            where: { id: apiKeyId, partnerId: principal.partner.id },
          })
          const now = new Date()
          if (
            !current
            || current.revokedAt
            || (current.expiresAt && current.expiresAt <= now)
          ) {
            throw new PartnerPortalApiKeyNotFoundError()
          }
          if (current.rotatedTo) {
            throw new PartnerPortalApiKeyValidationError('API key has already been rotated')
          }
          if (attempt < API_KEY_RETRY_ATTEMPTS) {
            continue
          }
          break
        }
        throw error
      }
    }
    throw new PartnerPortalApiKeyValidationError('Could not generate a unique API key')
  }

  private isRetryableRotationError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private normalizeInput(input: PartnerPortalApiKeyCreateInput): {
    expiresAt?: Date
    name: string
    scopeNames: PartnerApiKeyScopeName[]
    scopes: PartnerApiKeyScope[]
  } {
    const name = input.name.trim()
    if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(name)) {
      throw new PartnerPortalApiKeyValidationError(
        `API key name must be between 1 and ${MAX_NAME_LENGTH} printable characters`,
      )
    }
    const scopeNames = [...new Set(input.scopes)]
    if (
      scopeNames.length === 0
      || scopeNames.some(scope => !isPartnerApiKeyScopeName(scope))
    ) {
      throw new PartnerPortalApiKeyValidationError('Select at least one valid API key scope')
    }
    const typedScopeNames = scopeNames.filter(isPartnerApiKeyScopeName)

    if (input.expiresAt) {
      const expiresInMs = input.expiresAt.getTime() - Date.now()
      if (
        !Number.isFinite(input.expiresAt.getTime())
        || expiresInMs < MIN_EXPIRY_MS
        || expiresInMs > MAX_EXPIRY_MS
      ) {
        throw new PartnerPortalApiKeyValidationError(
          'API key expiry must be between five minutes and two years from now',
        )
      }
    }
    return {
      expiresAt: input.expiresAt,
      name,
      scopeNames: typedScopeNames,
      scopes: typedScopeNames.map(toDatabasePartnerApiKeyScope),
    }
  }

  private toSummary(apiKey: PartnerApiKey): PartnerPortalApiKeySummary {
    const now = new Date()
    const status = apiKey.revokedAt
      ? 'REVOKED'
      : apiKey.expiresAt && apiKey.expiresAt <= now
        ? 'EXPIRED'
        : 'ACTIVE'
    return {
      createdAt: apiKey.createdAt,
      displayPrefix: apiKey.displayPrefix,
      expiresAt: apiKey.expiresAt,
      id: apiKey.id,
      lastUsedAt: apiKey.lastUsedAt,
      name: apiKey.name,
      revokedAt: apiKey.revokedAt,
      scopes: apiKey.scopes.map(fromDatabasePartnerApiKeyScope),
      status,
    }
  }
}
