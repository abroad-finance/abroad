import { OpsConfigurationReleaseStatus, OpsConfigurationTargetType, OpsRole, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { FlowCorridorService } from '../../flows/application/FlowCorridorService'
import { FlowCorridorUpdateInput, flowCorridorUpdateSchema, FlowDefinitionInput, flowDefinitionSchema } from '../../flows/application/flowDefinitionSchemas'
import { FlowDefinitionService } from '../../flows/application/FlowDefinitionService'
import { CryptoAssetConfigService } from '../../payments/application/CryptoAssetConfigService'
import { CryptoAssetUpdateInput, cryptoAssetUpdateSchema } from '../../payments/application/cryptoAssetSchemas'
import { OpsAuditService } from './OpsAuditService'
import { OpsUserPrincipal } from './opsIdentity'
import { OpsMutationEnvelope } from './opsMutation'

const MAX_PAGE_SIZE = 100
const MAX_EFFECTIVE_DELAY_MS = 93 * 24 * 60 * 60 * 1_000
const MAX_DIFF_ENTRIES = 100

export type OpsConfigurationDiffEntry = {
  after: null | string
  before: null | string
  field: string
}

export type OpsConfigurationDraftInput = {
  effectiveAt?: Date
  payload: OpsConfigurationPayload
  title: string
}

export type OpsConfigurationPayload
  = | {
    definitionId?: string
    kind: 'FLOW_DEFINITION'
    operation: 'CREATE' | 'UPDATE'
    value: FlowDefinitionInput
  }
  | {
    kind: 'CRYPTO_ASSET'
    value: CryptoAssetUpdateInput
  }
  | {
    kind: 'FLOW_CORRIDOR'
    value: FlowCorridorUpdateInput
  }

export type OpsConfigurationReleaseDto = {
  appliedAt: Date | null
  appliedBy: null | OpsConfigurationReleaseUser
  appliedVersion: null | number
  approvalPolicy: OpsConfigurationApprovalPolicy
  approvedAt: Date | null
  approvedBy: null | OpsConfigurationReleaseUser
  baseVersion: number
  createdAt: Date
  diff: OpsConfigurationDiffEntry[]
  effectiveAt: Date | null
  id: string
  impact: string[]
  payload: OpsConfigurationPayload
  reason: string
  reference: null | string
  rejectionReason: null | string
  requestedBy: OpsConfigurationReleaseUser
  rollbackOfId: null | string
  status: OpsConfigurationReleaseStatus
  targetKey: string
  targetType: OpsConfigurationTargetType
  title: string
  updatedAt: Date
  version: number
}

export type OpsConfigurationReleaseList = {
  items: OpsConfigurationReleaseDto[]
  page: number
  pageSize: number
  total: number
}

export type OpsConfigurationReleaseQuery = {
  page: number
  pageSize: number
  query?: string
  status?: OpsConfigurationReleaseStatus
  targetType?: OpsConfigurationTargetType
}

export type OpsConfigurationReleaseUser = {
  displayName: string
  id: string
}

type ConfigurationSnapshot = {
  baseVersion: number
  payload: null | OpsConfigurationPayload
  targetKey: string
  targetType: OpsConfigurationTargetType
}

type OpsConfigurationApprovalPolicy
  = | 'DIFFERENT_ADMIN_REQUIRED'
    | 'SOLE_ADMIN_SELF_APPROVAL_ALLOWED'

type ReleaseWithUsers = Prisma.OpsConfigurationReleaseGetPayload<{
  include: {
    appliedBy: { select: { displayName: true, id: true } }
    approvedBy: { select: { displayName: true, id: true } }
    requestedBy: { select: { displayName: true, id: true } }
  }
}>

type StoredDiff = {
  after: OpsConfigurationPayload
  before: null | OpsConfigurationPayload
  changes: StoredDiffEntry[]
}

type StoredDiffEntry = {
  after: null | Prisma.JsonValue
  before: null | Prisma.JsonValue
  field: string
}

const releaseInclude = {
  appliedBy: { select: { displayName: true, id: true } },
  approvedBy: { select: { displayName: true, id: true } },
  requestedBy: { select: { displayName: true, id: true } },
} as const

const flowDefinitionPayloadSchema = z.object({
  definitionId: z.string().uuid().optional(),
  kind: z.literal('FLOW_DEFINITION'),
  operation: z.enum(['CREATE', 'UPDATE']),
  value: flowDefinitionSchema,
}).strict().superRefine((payload, context) => {
  if (payload.operation === 'UPDATE' && !payload.definitionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Definition ID is required for an update release',
      path: ['definitionId'],
    })
  }
  if (payload.operation === 'CREATE' && payload.definitionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Definition ID cannot be supplied for a create release',
      path: ['definitionId'],
    })
  }
})

const configurationPayloadSchema: z.ZodType<OpsConfigurationPayload> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CRYPTO_ASSET'),
    value: cryptoAssetUpdateSchema,
  }).strict(),
  z.object({
    kind: z.literal('FLOW_CORRIDOR'),
    value: flowCorridorUpdateSchema,
  }).strict(),
  flowDefinitionPayloadSchema,
])

export const opsConfigurationDraftInputSchema: z.ZodType<OpsConfigurationDraftInput> = z.object({
  effectiveAt: z.date().optional(),
  payload: configurationPayloadSchema,
  title: z.string().trim().min(3).max(160),
}).strict()

const storedDiffSchema: z.ZodType<StoredDiff> = z.object({
  after: configurationPayloadSchema,
  before: configurationPayloadSchema.nullable(),
  changes: z.array(z.object({
    after: z.unknown().nullable().transform(value => value as null | Prisma.JsonValue),
    before: z.unknown().nullable().transform(value => value as null | Prisma.JsonValue),
    field: z.string(),
  })).max(MAX_DIFF_ENTRIES),
}).strict()

export class OpsConfigurationReleaseConflictError extends ApplicationError {
  public constructor(message = 'This configuration release changed after it was loaded') {
    super(409, 'ops_configuration_release_conflict', message)
    this.name = 'OpsConfigurationReleaseConflictError'
  }
}

export class OpsConfigurationReleaseNotFoundError extends ApplicationError {
  public constructor() {
    super(404, 'ops_configuration_release_not_found', 'Configuration release not found')
    this.name = 'OpsConfigurationReleaseNotFoundError'
  }
}

export class OpsConfigurationReleaseValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_configuration_release_invalid', message)
    this.name = 'OpsConfigurationReleaseValidationError'
  }
}

@injectable()
export class OpsConfigurationReleaseService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(FlowDefinitionService)
    private readonly flowDefinitionService: FlowDefinitionService,
    @inject(FlowCorridorService)
    private readonly flowCorridorService: FlowCorridorService,
    @inject(CryptoAssetConfigService)
    private readonly cryptoAssetConfigService: CryptoAssetConfigService,
    @inject(OpsAuditService)
    private readonly auditService: OpsAuditService,
  ) {}

  public async applyDue(): Promise<number> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const due = await prismaClient.opsConfigurationRelease.findMany({
      orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, version: true },
      take: 20,
      where: {
        effectiveAt: { lte: new Date() },
        status: OpsConfigurationReleaseStatus.APPROVED,
      },
    })
    let appliedCount = 0
    for (const candidate of due) {
      const applied = await this.applyScheduled(candidate.id, candidate.version)
      if (applied) appliedCount += 1
    }
    return appliedCount
  }

  public async approve(
    releaseId: string,
    actor: OpsUserPrincipal,
    expectedVersion: number,
  ): Promise<OpsConfigurationReleaseDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.$transaction(async (transaction) => {
      const release = await transaction.opsConfigurationRelease.findUnique({
        where: { id: releaseId },
      })
      if (!release) throw new OpsConfigurationReleaseNotFoundError()
      this.assertState(release.status, OpsConfigurationReleaseStatus.PENDING_APPROVAL)
      this.assertVersion(release.version, expectedVersion)
      const selfApproval = release.requestedByUserId === actor.userId
      if (
        selfApproval
        && await this.resolveApprovalPolicy(transaction) !== 'SOLE_ADMIN_SELF_APPROVAL_ALLOWED'
      ) {
        throw new OpsConfigurationReleaseValidationError(
          'Another enabled administrator is available, so this release must be reviewed by a different operator',
        )
      }

      const now = new Date()
      const due = !release.effectiveAt || release.effectiveAt <= now
      const applied = due ? await this.applyTarget(transaction, release) : null
      const updated = await transaction.opsConfigurationRelease.updateMany({
        data: {
          appliedAt: applied ? now : null,
          appliedByUserId: applied ? actor.userId : null,
          appliedVersion: applied?.version,
          approvedAt: now,
          approvedByUserId: actor.userId,
          status: applied
            ? OpsConfigurationReleaseStatus.APPLIED
            : OpsConfigurationReleaseStatus.APPROVED,
          targetKey: applied?.targetKey ?? release.targetKey,
          version: { increment: 1 },
        },
        where: {
          id: release.id,
          status: OpsConfigurationReleaseStatus.PENDING_APPROVAL,
          version: expectedVersion,
        },
      })
      if (updated.count !== 1) throw new OpsConfigurationReleaseConflictError()
      if (applied && release.rollbackOfId) {
        await transaction.opsConfigurationRelease.updateMany({
          data: { status: OpsConfigurationReleaseStatus.ROLLED_BACK },
          where: {
            id: release.rollbackOfId,
            status: OpsConfigurationReleaseStatus.APPLIED,
          },
        })
      }
      if (selfApproval) {
        await this.auditService.record(actor, {
          action: 'configuration.release.sole_admin_approved',
          metadata: { approvalPolicy: 'SOLE_ADMIN_SELF_APPROVAL_ALLOWED' },
          resourceId: release.id,
          resourceType: 'configuration_release',
        }, transaction)
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return this.get(releaseId)
  }

  public async createDraft(
    actor: OpsUserPrincipal,
    input: OpsConfigurationDraftInput,
    envelope: OpsMutationEnvelope,
  ): Promise<OpsConfigurationReleaseDto> {
    const normalized = this.normalizeDraft(input)
    const prismaClient = await this.databaseClientProvider.getClient()
    const snapshot = await this.resolveSnapshot(prismaClient, normalized.payload)
    const diff = this.buildStoredDiff(snapshot.payload, normalized.payload)
    const created = await prismaClient.opsConfigurationRelease.create({
      data: {
        baseVersion: snapshot.baseVersion,
        diff: this.toInputJson(diff),
        effectiveAt: normalized.effectiveAt,
        idempotencyKey: envelope.idempotencyKey,
        impact: this.toInputJson(this.buildImpact(normalized.payload, diff.changes)),
        payload: this.toInputJson(normalized.payload),
        reason: envelope.reason,
        reference: envelope.reference,
        requestedByUserId: actor.userId,
        targetKey: snapshot.targetKey,
        targetType: snapshot.targetType,
        title: normalized.title,
      },
    })
    return this.get(created.id)
  }

  public async createRollbackDraft(
    actor: OpsUserPrincipal,
    releaseId: string,
    expectedVersion: number,
    envelope: OpsMutationEnvelope,
  ): Promise<OpsConfigurationReleaseDto> {
    const original = await this.getRecord(releaseId)
    this.assertVersion(original.version, expectedVersion)
    if (original.status !== OpsConfigurationReleaseStatus.APPLIED) {
      throw new OpsConfigurationReleaseValidationError('Only an applied release can be rolled back')
    }
    if (!original.appliedVersion) {
      throw new OpsConfigurationReleaseValidationError('The applied resource version is unavailable')
    }
    const storedDiff = this.parseStoredDiff(original.diff)
    const rollbackPayload = storedDiff.before ?? this.buildCreateRollback(original, storedDiff.after)
    const prismaClient = await this.databaseClientProvider.getClient()
    const current = await this.resolveSnapshot(prismaClient, rollbackPayload)
    if (current.baseVersion !== original.appliedVersion) {
      throw new OpsConfigurationReleaseConflictError(
        'The target changed after this release; create a new reviewed change instead',
      )
    }
    const diff = this.buildStoredDiff(current.payload, rollbackPayload)
    const created = await prismaClient.opsConfigurationRelease.create({
      data: {
        baseVersion: current.baseVersion,
        diff: this.toInputJson(diff),
        idempotencyKey: envelope.idempotencyKey,
        impact: this.toInputJson([
          `Reverts applied release ${original.id}`,
          ...this.buildImpact(rollbackPayload, diff.changes),
        ]),
        payload: this.toInputJson(rollbackPayload),
        reason: envelope.reason,
        reference: envelope.reference,
        requestedByUserId: actor.userId,
        rollbackOfId: original.id,
        targetKey: current.targetKey,
        targetType: current.targetType,
        title: `Rollback: ${original.title}`.slice(0, 160),
      },
    })
    return this.get(created.id)
  }

  public async get(releaseId: string): Promise<OpsConfigurationReleaseDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const [release, approvalPolicy] = await Promise.all([
      this.getRecord(releaseId, prismaClient),
      this.resolveApprovalPolicy(prismaClient),
    ])
    return this.toDto(release, approvalPolicy)
  }

  public async list(query: OpsConfigurationReleaseQuery): Promise<OpsConfigurationReleaseList> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const page = Math.max(1, query.page)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize))
    const where: Prisma.OpsConfigurationReleaseWhereInput = {
      OR: query.query
        ? [
            { targetKey: { contains: query.query, mode: 'insensitive' } },
            { title: { contains: query.query, mode: 'insensitive' } },
          ]
        : undefined,
      status: query.status,
      targetType: query.targetType,
    }
    const [approvalPolicy, items, total] = await Promise.all([
      this.resolveApprovalPolicy(prismaClient),
      prismaClient.opsConfigurationRelease.findMany({
        include: releaseInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      prismaClient.opsConfigurationRelease.count({ where }),
    ])
    return {
      items: items.map(item => this.toDto(item, approvalPolicy)),
      page,
      pageSize,
      total,
    }
  }

  public async reject(
    releaseId: string,
    actor: OpsUserPrincipal,
    expectedVersion: number,
    rejectionReason: string,
  ): Promise<OpsConfigurationReleaseDto> {
    const reason = rejectionReason.trim()
    if (reason.length < 10 || reason.length > 500) {
      throw new OpsConfigurationReleaseValidationError(
        'Explain the rejection in 10 to 500 characters',
      )
    }
    const release = await this.getRecord(releaseId)
    this.assertState(release.status, OpsConfigurationReleaseStatus.PENDING_APPROVAL)
    this.assertVersion(release.version, expectedVersion)
    if (release.requestedByUserId === actor.userId) {
      throw new OpsConfigurationReleaseValidationError(
        'A configuration release must be reviewed by a different operator',
      )
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    const updated = await prismaClient.opsConfigurationRelease.updateMany({
      data: {
        approvedByUserId: actor.userId,
        rejectionReason: reason,
        status: OpsConfigurationReleaseStatus.REJECTED,
        version: { increment: 1 },
      },
      where: {
        id: releaseId,
        status: OpsConfigurationReleaseStatus.PENDING_APPROVAL,
        version: expectedVersion,
      },
    })
    if (updated.count !== 1) throw new OpsConfigurationReleaseConflictError()
    return this.get(releaseId)
  }

  public async submit(
    releaseId: string,
    actor: OpsUserPrincipal,
    expectedVersion: number,
  ): Promise<OpsConfigurationReleaseDto> {
    const release = await this.getRecord(releaseId)
    this.assertState(release.status, OpsConfigurationReleaseStatus.DRAFT)
    this.assertVersion(release.version, expectedVersion)
    if (release.requestedByUserId !== actor.userId) {
      throw new OpsConfigurationReleaseValidationError(
        'Only the draft owner can submit this release for approval',
      )
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    const updated = await prismaClient.opsConfigurationRelease.updateMany({
      data: {
        status: OpsConfigurationReleaseStatus.PENDING_APPROVAL,
        version: { increment: 1 },
      },
      where: {
        id: releaseId,
        requestedByUserId: actor.userId,
        status: OpsConfigurationReleaseStatus.DRAFT,
        version: expectedVersion,
      },
    })
    if (updated.count !== 1) throw new OpsConfigurationReleaseConflictError()
    return this.get(releaseId)
  }

  public async updateDraft(
    releaseId: string,
    actor: OpsUserPrincipal,
    expectedVersion: number,
    input: OpsConfigurationDraftInput,
    envelope: OpsMutationEnvelope,
  ): Promise<OpsConfigurationReleaseDto> {
    const release = await this.getRecord(releaseId)
    this.assertState(release.status, OpsConfigurationReleaseStatus.DRAFT)
    this.assertVersion(release.version, expectedVersion)
    if (release.requestedByUserId !== actor.userId) {
      throw new OpsConfigurationReleaseValidationError('Only the draft owner can edit this release')
    }
    const normalized = this.normalizeDraft(input)
    const prismaClient = await this.databaseClientProvider.getClient()
    const snapshot = await this.resolveSnapshot(prismaClient, normalized.payload)
    const diff = this.buildStoredDiff(snapshot.payload, normalized.payload)
    const updated = await prismaClient.opsConfigurationRelease.updateMany({
      data: {
        baseVersion: snapshot.baseVersion,
        diff: this.toInputJson(diff),
        effectiveAt: normalized.effectiveAt,
        impact: this.toInputJson(this.buildImpact(normalized.payload, diff.changes)),
        payload: this.toInputJson(normalized.payload),
        reason: envelope.reason,
        reference: envelope.reference,
        targetKey: snapshot.targetKey,
        targetType: snapshot.targetType,
        title: normalized.title,
        version: { increment: 1 },
      },
      where: {
        id: releaseId,
        requestedByUserId: actor.userId,
        status: OpsConfigurationReleaseStatus.DRAFT,
        version: expectedVersion,
      },
    })
    if (updated.count !== 1) throw new OpsConfigurationReleaseConflictError()
    return this.get(releaseId)
  }

  private async applyScheduled(releaseId: string, expectedVersion: number): Promise<boolean> {
    const prismaClient = await this.databaseClientProvider.getClient()
    try {
      const result = await prismaClient.$transaction(async (transaction) => {
        const release = await transaction.opsConfigurationRelease.findUnique({
          where: { id: releaseId },
        })
        if (
          !release
          || release.status !== OpsConfigurationReleaseStatus.APPROVED
          || release.version !== expectedVersion
          || !release.effectiveAt
          || release.effectiveAt > new Date()
        ) {
          return false
        }
        const applied = await this.applyTarget(transaction, release)
        const updated = await transaction.opsConfigurationRelease.updateMany({
          data: {
            appliedAt: new Date(),
            appliedVersion: applied.version,
            status: OpsConfigurationReleaseStatus.APPLIED,
            targetKey: applied.targetKey,
            version: { increment: 1 },
          },
          where: {
            id: release.id,
            status: OpsConfigurationReleaseStatus.APPROVED,
            version: expectedVersion,
          },
        })
        if (updated.count !== 1) throw new OpsConfigurationReleaseConflictError()
        if (release.rollbackOfId) {
          await transaction.opsConfigurationRelease.updateMany({
            data: { status: OpsConfigurationReleaseStatus.ROLLED_BACK },
            where: {
              id: release.rollbackOfId,
              status: OpsConfigurationReleaseStatus.APPLIED,
            },
          })
        }
        return true
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      if (result) {
        await this.auditService.recordSystem({
          action: 'configuration.release.applied',
          resourceId: releaseId,
          resourceType: 'configuration_release',
        })
      }
      return result
    }
    catch (error) {
      await this.auditService.recordSystem({
        action: 'configuration.release.apply_failed',
        metadata: {
          failureCode: error instanceof ApplicationError ? error.code : 'unexpected_error',
        },
        resourceId: releaseId,
        resourceType: 'configuration_release',
      })
      return false
    }
  }

  private async applyTarget(
    transaction: Prisma.TransactionClient,
    release: Pick<ReleaseWithUsers, 'baseVersion' | 'payload' | 'targetKey'>,
  ): Promise<{ targetKey: string, version: number }> {
    const payload = this.parsePayload(release.payload)
    if (payload.kind === 'CRYPTO_ASSET') {
      const applied = await this.cryptoAssetConfigService.upsertInTransaction(
        transaction,
        payload.value,
        release.baseVersion,
      )
      return { targetKey: this.targetKey(payload), version: applied.version }
    }
    if (payload.kind === 'FLOW_CORRIDOR') {
      const applied = await this.flowCorridorService.updateStatusInTransaction(
        transaction,
        payload.value,
        release.baseVersion,
      )
      return { targetKey: this.targetKey(payload), version: applied.version }
    }
    if (payload.operation === 'CREATE') {
      const applied = await this.flowDefinitionService.createInTransaction(
        transaction,
        payload.value,
      )
      return { targetKey: applied.id, version: applied.version }
    }
    const definitionId = payload.definitionId
    if (!definitionId) {
      throw new OpsConfigurationReleaseValidationError('Definition ID is required')
    }
    const applied = await this.flowDefinitionService.updateInTransaction(
      transaction,
      definitionId,
      payload.value,
      release.baseVersion,
    )
    return { targetKey: applied.id, version: applied.version }
  }

  private assertState(
    actual: OpsConfigurationReleaseStatus,
    expected: OpsConfigurationReleaseStatus,
  ): void {
    if (actual !== expected) {
      throw new OpsConfigurationReleaseConflictError(
        `Release is ${actual.toLowerCase().replaceAll('_', ' ')}, not ${expected.toLowerCase().replaceAll('_', ' ')}`,
      )
    }
  }

  private assertVersion(actual: number, expected: number): void {
    if (actual !== expected) throw new OpsConfigurationReleaseConflictError()
  }

  private buildCreateRollback(
    original: Pick<ReleaseWithUsers, 'targetKey'>,
    appliedPayload: OpsConfigurationPayload,
  ): OpsConfigurationPayload {
    if (appliedPayload.kind !== 'FLOW_DEFINITION' || appliedPayload.operation !== 'CREATE') {
      throw new OpsConfigurationReleaseValidationError('This release has no reversible prior state')
    }
    return {
      definitionId: original.targetKey,
      kind: 'FLOW_DEFINITION',
      operation: 'UPDATE',
      value: { ...appliedPayload.value, enabled: false },
    }
  }

  private buildImpact(
    payload: OpsConfigurationPayload,
    changes: StoredDiffEntry[],
  ): string[] {
    const fields = new Set(changes.map(change => change.field))
    const impact = new Set<string>()
    if (payload.kind === 'FLOW_CORRIDOR') {
      impact.add('Changes whether this corridor can accept new payment work.')
    }
    if (payload.kind === 'CRYPTO_ASSET') {
      impact.add('Changes source-asset eligibility and network verification for future payments.')
    }
    if (payload.kind === 'FLOW_DEFINITION') {
      impact.add('Changes execution only for future work; existing flow snapshots remain unchanged.')
      if ([...fields].some(field => field.includes('Fee') || field.includes('Amount'))) {
        impact.add('Changes quoted fees or payout bounds for this corridor.')
      }
      if ([...fields].some(field => field.includes('Provider') || field.includes('steps'))) {
        impact.add('Changes provider or treasury routing for future execution.')
      }
    }
    if (changes.length === 0) impact.add('No effective configuration difference was detected.')
    return [...impact]
  }

  private buildStoredDiff(
    before: null | OpsConfigurationPayload,
    after: OpsConfigurationPayload,
  ): StoredDiff {
    const beforeJson = before ? this.toJson(before) : null
    const afterJson = this.toJson(after)
    return {
      after,
      before,
      changes: this.diffValues(beforeJson, afterJson),
    }
  }

  private diffValues(
    before: null | Prisma.JsonValue,
    after: null | Prisma.JsonValue,
    path = '',
  ): StoredDiffEntry[] {
    if (JSON.stringify(before) === JSON.stringify(after)) return []
    if (this.isJsonObject(before) && this.isJsonObject(after)) {
      const fields = [...new Set([...Object.keys(after), ...Object.keys(before)])].sort()
      return fields.flatMap(field => this.diffValues(
        before[field] ?? null,
        after[field] ?? null,
        path ? `${path}.${field}` : field,
      )).slice(0, MAX_DIFF_ENTRIES)
    }
    return [{ after, before, field: path || 'configuration' }]
  }

  private async getRecord(
    releaseId: string,
    client?: Prisma.TransactionClient,
  ): Promise<ReleaseWithUsers> {
    const prismaClient = client ?? await this.databaseClientProvider.getClient()
    const release = await prismaClient.opsConfigurationRelease.findUnique({
      include: releaseInclude,
      where: { id: releaseId },
    })
    if (!release) throw new OpsConfigurationReleaseNotFoundError()
    return release
  }

  private isJsonObject(value: null | Prisma.JsonValue): value is Prisma.JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  private normalizeDraft(input: OpsConfigurationDraftInput): OpsConfigurationDraftInput {
    const parsed = opsConfigurationDraftInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new OpsConfigurationReleaseValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid configuration draft',
      )
    }
    if (
      parsed.data.effectiveAt
      && parsed.data.effectiveAt.getTime() - Date.now() > MAX_EFFECTIVE_DELAY_MS
    ) {
      throw new OpsConfigurationReleaseValidationError(
        'Effective time must be within the next 93 days',
      )
    }
    return parsed.data
  }

  private parsePayload(payload: Prisma.JsonValue): OpsConfigurationPayload {
    const parsed = configurationPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw new OpsConfigurationReleaseValidationError('Stored release payload is invalid')
    }
    return parsed.data
  }

  private parseStoredDiff(diff: Prisma.JsonValue): StoredDiff {
    const parsed = storedDiffSchema.safeParse(diff)
    if (!parsed.success) {
      throw new OpsConfigurationReleaseValidationError('Stored release diff is invalid')
    }
    return parsed.data
  }

  private async resolveApprovalPolicy(
    client: Prisma.TransactionClient,
  ): Promise<OpsConfigurationApprovalPolicy> {
    const enabledAdministratorCount = await client.opsUser.count({
      where: {
        disabledAt: null,
        role: OpsRole.ADMINISTRATOR,
      },
    })
    return enabledAdministratorCount === 1
      ? 'SOLE_ADMIN_SELF_APPROVAL_ALLOWED'
      : 'DIFFERENT_ADMIN_REQUIRED'
  }

  private async resolveSnapshot(
    client: Prisma.TransactionClient,
    payload: OpsConfigurationPayload,
  ): Promise<ConfigurationSnapshot> {
    if (payload.kind === 'FLOW_DEFINITION') {
      if (payload.operation === 'CREATE') {
        const existing = await client.flowDefinition.findFirst({
          where: {
            blockchain: payload.value.blockchain,
            cryptoCurrency: payload.value.cryptoCurrency,
            targetCurrency: payload.value.targetCurrency,
          },
        })
        if (existing) {
          throw new OpsConfigurationReleaseValidationError(
            'A definition already exists for this corridor; create an update release instead',
          )
        }
        return {
          baseVersion: 0,
          payload: null,
          targetKey: this.targetKey(payload),
          targetType: OpsConfigurationTargetType.FLOW_DEFINITION,
        }
      }
      const definitionId = payload.definitionId
      if (!definitionId) throw new OpsConfigurationReleaseValidationError('Definition ID is required')
      const definition = await this.flowDefinitionService.findById(definitionId, client)
      if (!definition) {
        throw new OpsConfigurationReleaseValidationError('Flow definition not found')
      }
      return {
        baseVersion: definition.version,
        payload: {
          definitionId,
          kind: 'FLOW_DEFINITION',
          operation: 'UPDATE',
          value: {
            blockchain: definition.blockchain,
            cryptoCurrency: definition.cryptoCurrency,
            enabled: definition.enabled,
            exchangeFeePct: definition.exchangeFeePct,
            fixedFee: definition.fixedFee,
            maxAmount: definition.maxAmount,
            minAmount: definition.minAmount,
            name: definition.name,
            payoutProvider: definition.payoutProvider,
            pricingProvider: definition.pricingProvider,
            steps: definition.steps,
            targetCurrency: definition.targetCurrency,
          },
        },
        targetKey: definitionId,
        targetType: OpsConfigurationTargetType.FLOW_DEFINITION,
      }
    }

    if (payload.kind === 'FLOW_CORRIDOR') {
      const list = await this.flowCorridorService.list(client)
      const current = list.corridors.find(item => (
        item.blockchain === payload.value.blockchain
        && item.cryptoCurrency === payload.value.cryptoCurrency
        && item.targetCurrency === payload.value.targetCurrency
      ))
      if (!current) throw new OpsConfigurationReleaseValidationError('Flow corridor not found')
      return {
        baseVersion: current.version,
        payload: {
          kind: 'FLOW_CORRIDOR',
          value: {
            blockchain: current.blockchain,
            cryptoCurrency: current.cryptoCurrency,
            reason: current.unsupportedReason ?? undefined,
            status: current.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'SUPPORTED',
            targetCurrency: current.targetCurrency,
          },
        },
        targetKey: this.targetKey(payload),
        targetType: OpsConfigurationTargetType.FLOW_CORRIDOR,
      }
    }

    const coverage = await this.cryptoAssetConfigService.listCoverage(client)
    const current = coverage.assets.find(item => (
      item.blockchain === payload.value.blockchain
      && item.cryptoCurrency === payload.value.cryptoCurrency
    ))
    if (!current) throw new OpsConfigurationReleaseValidationError('Crypto asset coverage not found')
    return {
      baseVersion: current.version,
      payload: {
        kind: 'CRYPTO_ASSET',
        value: {
          blockchain: current.blockchain,
          cryptoCurrency: current.cryptoCurrency,
          decimals: current.decimals ?? null,
          enabled: current.enabled,
          mintAddress: current.mintAddress ?? null,
        },
      },
      targetKey: this.targetKey(payload),
      targetType: OpsConfigurationTargetType.CRYPTO_ASSET,
    }
  }

  private serializeDiffValue(value: null | Prisma.JsonValue): null | string {
    if (value === null) return null
    return typeof value === 'string' ? value : JSON.stringify(value)
  }

  private targetKey(payload: OpsConfigurationPayload): string {
    if (payload.kind === 'FLOW_DEFINITION') {
      return payload.definitionId
        ?? `new:${payload.value.cryptoCurrency}:${payload.value.blockchain}:${payload.value.targetCurrency}`
    }
    if (payload.kind === 'FLOW_CORRIDOR') {
      return `${payload.value.cryptoCurrency}:${payload.value.blockchain}:${payload.value.targetCurrency}`
    }
    return `${payload.value.cryptoCurrency}:${payload.value.blockchain}`
  }

  private toDto(
    release: ReleaseWithUsers,
    approvalPolicy: OpsConfigurationApprovalPolicy,
  ): OpsConfigurationReleaseDto {
    const storedDiff = this.parseStoredDiff(release.diff)
    const impact = z.array(z.string()).safeParse(release.impact)
    return {
      appliedAt: release.appliedAt,
      appliedBy: release.appliedBy,
      appliedVersion: release.appliedVersion,
      approvalPolicy,
      approvedAt: release.approvedAt,
      approvedBy: release.approvedBy,
      baseVersion: release.baseVersion,
      createdAt: release.createdAt,
      diff: storedDiff.changes.map(change => ({
        after: this.serializeDiffValue(change.after),
        before: this.serializeDiffValue(change.before),
        field: change.field,
      })),
      effectiveAt: release.effectiveAt,
      id: release.id,
      impact: impact.success ? impact.data : [],
      payload: this.parsePayload(release.payload),
      reason: release.reason,
      reference: release.reference,
      rejectionReason: release.rejectionReason,
      requestedBy: release.requestedBy,
      rollbackOfId: release.rollbackOfId,
      status: release.status,
      targetKey: release.targetKey,
      targetType: release.targetType,
      title: release.title,
      updatedAt: release.updatedAt,
      version: release.version,
    }
  }

  private toInputJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
  }

  private toJson(value: unknown): Prisma.JsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue
  }
}
