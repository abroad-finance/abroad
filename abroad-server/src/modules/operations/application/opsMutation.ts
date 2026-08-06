import type { OpsMutationExecution, Prisma } from '@prisma/client'

import { OpsMutationStatus, Prisma as PrismaNamespace } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import type { OpsPermission } from './opsPermissions'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsAuditService } from './OpsAuditService'
import { OpsPrincipal, OpsUserPrincipal } from './opsIdentity'

const DEFAULT_STEP_UP_MAX_AGE_MS = 10 * 60 * 1_000

export const OPS_MUTATION_HEADERS = {
  confirmation: 'X-Ops-Confirmation',
  expectedVersion: 'If-Match',
  idempotencyKey: 'X-Ops-Idempotency-Key',
  reason: 'X-Ops-Reason',
  reference: 'X-Ops-Reference',
} as const

const opsMutationEnvelopeSchema = z.object({
  confirmation: z.string().trim().min(1).max(100),
  expectedVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  reference: z.string().trim().max(120).optional(),
}).strict()

type OpsApprovalClass = 'CONFIRMATION' | 'DIRECT' | 'SECOND_APPROVER' | 'STEP_UP'

export type OpsMutationAction = keyof typeof OPS_MUTATION_POLICIES

export type OpsMutationEnvelope = z.infer<typeof opsMutationEnvelopeSchema>

type OpsMutationPolicy = {
  approvalClass: OpsApprovalClass
  confirmation: string
  expectedVersion: boolean
  impact: string
  permission: OpsPermission
  stepUpMaxAgeMs: null | number
}

type MutationOutcome = {
  metadata?: Prisma.InputJsonObject
  resourceId?: string
}

type OpsMutationContext = {
  action: OpsMutationAction
  envelope: OpsMutationEnvelope
  executionId: string
  policy: OpsMutationPolicy
  principal: OpsUserPrincipal
  resource: OpsMutationResource
}

type OpsMutationResource = {
  id?: string
  type: string
}

export const OPS_MUTATION_POLICIES = {
  'administration.user.disable': {
    approvalClass: 'STEP_UP',
    confirmation: 'DISABLE OPS USER',
    expectedVersion: true,
    impact: 'Immediately blocks this operator and invalidates their current Ops sessions.',
    permission: 'administration:users',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'administration.user.enable': {
    approvalClass: 'STEP_UP',
    confirmation: 'ENABLE OPS USER',
    expectedVersion: true,
    impact: 'Restores this operator’s ability to authenticate to production Ops.',
    permission: 'administration:users',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'administration.user.invite': {
    approvalClass: 'STEP_UP',
    confirmation: 'INVITE OPS USER',
    expectedVersion: false,
    impact: 'Admits a new organization account to production Ops with the selected role.',
    permission: 'administration:users',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'administration.user.revoke_sessions': {
    approvalClass: 'STEP_UP',
    confirmation: 'REVOKE OPS SESSIONS',
    expectedVersion: true,
    impact: 'Invalidates this operator’s existing Ops authentication until they verify again.',
    permission: 'administration:users',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'administration.user.role_update': {
    approvalClass: 'STEP_UP',
    confirmation: 'CHANGE OPS ROLE',
    expectedVersion: true,
    impact: 'Changes the production data and actions available to this operator.',
    permission: 'administration:users',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'case.create': {
    approvalClass: 'DIRECT',
    confirmation: 'OPEN CASE',
    expectedVersion: false,
    impact: 'Creates a durable operations case linked to this production transaction.',
    permission: 'cases:manage',
    stepUpMaxAgeMs: null,
  },
  'case.escalate': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'ESCALATE CASE',
    expectedVersion: false,
    impact: 'Adds a visible escalation entry to the transaction case and shift handoff history.',
    permission: 'cases:manage',
    stepUpMaxAgeMs: null,
  },
  'case.handoff': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'HAND OFF CASE',
    expectedVersion: true,
    impact: 'Transfers explicit responsibility for unresolved transaction work.',
    permission: 'cases:manage',
    stepUpMaxAgeMs: null,
  },
  'case.note.add': {
    approvalClass: 'DIRECT',
    confirmation: 'ADD CASE NOTE',
    expectedVersion: false,
    impact: 'Adds an immutable PII-free note to the transaction case.',
    permission: 'cases:manage',
    stepUpMaxAgeMs: null,
  },
  'case.update': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'UPDATE CASE',
    expectedVersion: true,
    impact: 'Changes case priority, status, ownership, or team responsibility.',
    permission: 'cases:manage',
    stepUpMaxAgeMs: null,
  },
  'configuration.asset.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE ASSET',
    expectedVersion: true,
    impact: 'Changes production asset coverage and payment routing eligibility.',
    permission: 'configuration:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'configuration.corridor.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE CORRIDOR',
    expectedVersion: true,
    impact: 'Changes whether a production corridor can accept new payment work.',
    permission: 'configuration:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'configuration.definition.create': {
    approvalClass: 'STEP_UP',
    confirmation: 'CREATE FLOW',
    expectedVersion: false,
    impact: 'Creates a production execution definition for future payment work.',
    permission: 'configuration:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'configuration.definition.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE FLOW',
    expectedVersion: true,
    impact: 'Changes how future production payment work is executed.',
    permission: 'configuration:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'configuration.release.approve': {
    approvalClass: 'SECOND_APPROVER',
    confirmation: 'APPROVE CONFIG RELEASE',
    expectedVersion: true,
    impact: 'Approves a reviewed production configuration change and applies it when its effective time is due.',
    permission: 'configuration:approve',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'configuration.release.create': {
    approvalClass: 'DIRECT',
    confirmation: 'CREATE CONFIG DRAFT',
    expectedVersion: false,
    impact: 'Creates a reviewable configuration draft without changing production behavior.',
    permission: 'configuration:manage',
    stepUpMaxAgeMs: null,
  },
  'configuration.release.reject': {
    approvalClass: 'SECOND_APPROVER',
    confirmation: 'REJECT CONFIG RELEASE',
    expectedVersion: true,
    impact: 'Rejects a submitted configuration release without changing production behavior.',
    permission: 'configuration:approve',
    stepUpMaxAgeMs: null,
  },
  'configuration.release.rollback': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'CREATE ROLLBACK',
    expectedVersion: true,
    impact: 'Creates a reviewable rollback draft; production behavior remains unchanged until it is approved.',
    permission: 'configuration:manage',
    stepUpMaxAgeMs: null,
  },
  'configuration.release.submit': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'SUBMIT CONFIG RELEASE',
    expectedVersion: true,
    impact: 'Locks the draft and submits it for review by a different authorized operator.',
    permission: 'configuration:manage',
    stepUpMaxAgeMs: null,
  },
  'configuration.release.update': {
    approvalClass: 'DIRECT',
    confirmation: 'UPDATE CONFIG DRAFT',
    expectedVersion: true,
    impact: 'Updates a configuration draft without changing production behavior.',
    permission: 'configuration:manage',
    stepUpMaxAgeMs: null,
  },
  'credentials.api_key.revoke': {
    approvalClass: 'STEP_UP',
    confirmation: 'REVOKE KEY',
    expectedVersion: false,
    impact: 'Immediately prevents the partner credential from authenticating.',
    permission: 'credentials:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'credentials.api_key.rotate': {
    approvalClass: 'STEP_UP',
    confirmation: 'ROTATE KEY',
    expectedVersion: false,
    impact: 'Replaces the active partner credential and requires coordinated adoption.',
    permission: 'credentials:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'credentials.client_domain.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE DOMAIN',
    expectedVersion: false,
    impact: 'Changes the browser origin allowed to identify this partner.',
    permission: 'credentials:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'credentials.portal_user.upsert': {
    approvalClass: 'STEP_UP',
    confirmation: 'PROVISION USER',
    expectedVersion: false,
    impact: 'Creates or changes a partner-portal administrator identity.',
    permission: 'credentials:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'flow.bulk_retry': {
    approvalClass: 'STEP_UP',
    confirmation: 'RETRY FLOWS',
    expectedVersion: false,
    impact: 'Requeues failed production work and may invoke financial providers.',
    permission: 'flows:recover',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'flow.resume': {
    approvalClass: 'STEP_UP',
    confirmation: 'RESUME FLOW',
    expectedVersion: false,
    impact: 'Resumes a stalled production workflow at its failed step.',
    permission: 'flows:recover',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'flow.step.force_retry': {
    approvalClass: 'STEP_UP',
    confirmation: 'FORCE RETRY',
    expectedVersion: false,
    impact: 'Requeues running work and can duplicate non-idempotent financial execution.',
    permission: 'flows:recover',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'flow.step.requeue': {
    approvalClass: 'STEP_UP',
    confirmation: 'REQUEUE STEP',
    expectedVersion: false,
    impact: 'Returns a production step to the execution queue.',
    permission: 'flows:recover',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'flow.step.retry': {
    approvalClass: 'STEP_UP',
    confirmation: 'RETRY STEP',
    expectedVersion: false,
    impact: 'Retries failed production execution at this step.',
    permission: 'flows:recover',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'incident.escalate': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'ESCALATE INCIDENT',
    expectedVersion: false,
    impact: 'Adds a visible escalation to the incident and shift handoff history.',
    permission: 'incidents:manage',
    stepUpMaxAgeMs: null,
  },
  'incident.handoff': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'HAND OFF INCIDENT',
    expectedVersion: true,
    impact: 'Transfers explicit responsibility for an unresolved production incident.',
    permission: 'incidents:manage',
    stepUpMaxAgeMs: null,
  },
  'incident.note.add': {
    approvalClass: 'DIRECT',
    confirmation: 'ADD INCIDENT NOTE',
    expectedVersion: false,
    impact: 'Adds an immutable PII-free note to the incident timeline.',
    permission: 'incidents:manage',
    stepUpMaxAgeMs: null,
  },
  'incident.update': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'UPDATE INCIDENT',
    expectedVersion: true,
    impact: 'Changes incident acknowledgement, resolution, ownership, or runbook responsibility.',
    permission: 'incidents:manage',
    stepUpMaxAgeMs: null,
  },
  'integration.create': {
    approvalClass: 'STEP_UP',
    confirmation: 'CREATE INTEGRATION',
    expectedVersion: false,
    impact: 'Adds non-secret production operational metadata for a provider, notification destination, or runbook system.',
    permission: 'administration:integrations',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'integration.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE INTEGRATION',
    expectedVersion: true,
    impact: 'Changes production operational routing or health metadata without storing credentials.',
    permission: 'administration:integrations',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'kyc.submission.assign': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'ASSIGN KYC REVIEW',
    expectedVersion: true,
    impact: 'Changes who owns the next review action for this identity submission.',
    permission: 'kyc:decide',
    stepUpMaxAgeMs: null,
  },
  'kyc.submission.reject': {
    approvalClass: 'STEP_UP',
    confirmation: 'REJECT KYC',
    expectedVersion: false,
    impact: 'Changes the compliance decision for this identity submission.',
    permission: 'kyc:decide',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'kyc.user.disable': {
    approvalClass: 'STEP_UP',
    confirmation: 'DISABLE USER',
    expectedVersion: false,
    impact: 'Prevents this user from initiating new activity.',
    permission: 'kyc:decide',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'kyc.user.enable': {
    approvalClass: 'STEP_UP',
    confirmation: 'ENABLE USER',
    expectedVersion: false,
    impact: 'Restores this user’s ability to initiate activity.',
    permission: 'kyc:decide',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'partner.create': {
    approvalClass: 'STEP_UP',
    confirmation: 'CREATE PARTNER',
    expectedVersion: false,
    impact: 'Creates a production partner account and its operational identity.',
    permission: 'partners:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'partner.kyb_approval.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE KYB',
    expectedVersion: false,
    impact: 'Approving lifts the $100 lifetime cap; revoking re-applies it to all future transactions.',
    permission: 'partners:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'partner.kyc_requirement.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE KYC',
    expectedVersion: false,
    impact: 'Turning this off lets every user of the partner transact unverified at any amount.',
    permission: 'partners:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'partner.profile.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE PARTNER',
    expectedVersion: false,
    impact: 'Changes the partner contact record used for operational and compliance correspondence.',
    permission: 'partners:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'partner.status.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'SUSPEND PARTNER',
    expectedVersion: false,
    impact: 'Suspending immediately stops every API key and client-domain session for this partner from authenticating.',
    permission: 'partners:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'partner.webhook.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE WEBHOOK',
    expectedVersion: false,
    impact: 'Redirects transaction callbacks for this partner to a different endpoint.',
    permission: 'partners:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'runbook.create': {
    approvalClass: 'STEP_UP',
    confirmation: 'CREATE RUNBOOK',
    expectedVersion: false,
    impact: 'Publishes a production response guide for matching incident categories.',
    permission: 'administration:integrations',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'runbook.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE RUNBOOK',
    expectedVersion: true,
    impact: 'Changes the production response guide shown for matching incidents.',
    permission: 'administration:integrations',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'saved_view.create': {
    approvalClass: 'DIRECT',
    confirmation: 'SAVE VIEW',
    expectedVersion: false,
    impact: 'Stores this filter set for your account or the operations team.',
    permission: 'saved_views:manage',
    stepUpMaxAgeMs: null,
  },
  'saved_view.delete': {
    approvalClass: 'CONFIRMATION',
    confirmation: 'DELETE VIEW',
    expectedVersion: true,
    impact: 'Permanently removes this saved filter view without changing operational records.',
    permission: 'saved_views:manage',
    stepUpMaxAgeMs: null,
  },
  'saved_view.update': {
    approvalClass: 'DIRECT',
    confirmation: 'UPDATE VIEW',
    expectedVersion: true,
    impact: 'Replaces the stored filters or sharing scope for this saved view.',
    permission: 'saved_views:manage',
    stepUpMaxAgeMs: null,
  },
  'transaction.reconcile_hash': {
    approvalClass: 'STEP_UP',
    confirmation: 'RECONCILE HASH',
    expectedVersion: false,
    impact: 'Repairs on-chain evidence and may advance transaction processing.',
    permission: 'transactions:reconcile',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'transaction.refund.reconcile': {
    approvalClass: 'STEP_UP',
    confirmation: 'RECONCILE REFUND',
    expectedVersion: true,
    impact: 'Checks every durable refund hash and records a confirmed refund or replacement eligibility.',
    permission: 'transactions:refund',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'transaction.refund.replace': {
    approvalClass: 'STEP_UP',
    confirmation: 'ISSUE REPLACEMENT REFUND',
    expectedVersion: true,
    impact: 'Submits the exact original crypto amount back to its verified sender after fresh absence proof.',
    permission: 'transactions:refund',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'treasury.threshold.create': {
    approvalClass: 'STEP_UP',
    confirmation: 'CREATE TREASURY THRESHOLD',
    expectedVersion: false,
    impact: 'Adds production alert and runway thresholds for one venue and currency without moving funds.',
    permission: 'treasury:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
  'treasury.threshold.update': {
    approvalClass: 'STEP_UP',
    confirmation: 'UPDATE TREASURY THRESHOLD',
    expectedVersion: true,
    impact: 'Changes production alert and runway thresholds without moving funds.',
    permission: 'treasury:manage',
    stepUpMaxAgeMs: DEFAULT_STEP_UP_MAX_AGE_MS,
  },
} as const satisfies Readonly<Record<string, OpsMutationPolicy>>

export class OpsMutationAuthorizationError extends ApplicationError {
  public constructor(message = 'Named Ops authorization is required for this action') {
    super(403, 'ops_mutation_forbidden', message)
    this.name = 'OpsMutationAuthorizationError'
  }
}

export class OpsMutationReplayError extends ApplicationError {
  public constructor(execution: Pick<OpsMutationExecution, 'id' | 'status'>) {
    super(409, 'ops_mutation_replayed', 'This operation has already been requested', {
      executionId: execution.id,
      status: execution.status,
    })
    this.name = 'OpsMutationReplayError'
  }
}

export class OpsMutationStepUpError extends ApplicationError {
  public constructor() {
    super(401, 'ops_step_up_required', 'Verify your organization account again before continuing')
    this.name = 'OpsMutationStepUpError'
  }
}

export class OpsMutationValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_mutation_invalid', message)
    this.name = 'OpsMutationValidationError'
  }
}

const normalizeResource = (resource: OpsMutationResource): OpsMutationResource => {
  const type = resource.type.trim()
  const id = resource.id?.trim()
  if (!type) {
    throw new OpsMutationValidationError('Operation resource type is required')
  }
  return { id: id || undefined, type }
}

const errorCode = (error: unknown): string => {
  if (error instanceof ApplicationError) return error.code
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.name)
    ? error.name
    : 'unexpected_error'
}

@injectable()
export class OpsMutationService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(OpsAuditService)
    private readonly auditService: OpsAuditService,
  ) {}

  public async execute<TResult>(
    principal: OpsPrincipal,
    action: OpsMutationAction,
    resource: OpsMutationResource,
    envelopeInput: OpsMutationEnvelope,
    operation: () => Promise<TResult>,
    outcome: (result: TResult) => MutationOutcome = () => ({}),
  ): Promise<TResult> {
    const context = await this.begin(principal, action, resource, envelopeInput)
    try {
      const result = await operation()
      await this.complete(context, outcome(result))
      return result
    }
    catch (error) {
      await this.fail(context, error)
      throw error
    }
  }

  public async executeDatabase<TResult>(
    principal: OpsPrincipal,
    action: OpsMutationAction,
    resource: OpsMutationResource,
    envelopeInput: OpsMutationEnvelope,
    operation: (transaction: Prisma.TransactionClient) => Promise<TResult>,
    outcome: (result: TResult) => MutationOutcome = () => ({}),
  ): Promise<TResult> {
    const context = await this.begin(principal, action, resource, envelopeInput)
    const prismaClient = await this.databaseClientProvider.getClient()
    try {
      return await prismaClient.$transaction(async (transaction) => {
        const result = await operation(transaction)
        await this.complete(context, outcome(result), transaction)
        return result
      })
    }
    catch (error) {
      await this.fail(context, error)
      throw error
    }
  }

  private authorize(
    principal: OpsPrincipal,
    policy: OpsMutationPolicy,
    now = new Date(),
  ): OpsUserPrincipal {
    if (principal.kind !== 'ops_user' || !principal.permissions.includes(policy.permission)) {
      throw new OpsMutationAuthorizationError()
    }
    if (
      policy.stepUpMaxAgeMs !== null
      && now.getTime() - principal.authTime.getTime() > policy.stepUpMaxAgeMs
    ) {
      throw new OpsMutationStepUpError()
    }
    return principal
  }

  private async begin(
    principal: OpsPrincipal,
    action: OpsMutationAction,
    resourceInput: OpsMutationResource,
    envelopeInput: OpsMutationEnvelope,
  ): Promise<OpsMutationContext> {
    const policy = OPS_MUTATION_POLICIES[action]
    const principalUser = this.authorize(principal, policy)
    const envelopeResult = opsMutationEnvelopeSchema.safeParse(envelopeInput)
    if (!envelopeResult.success) {
      throw new OpsMutationValidationError(
        envelopeResult.error.issues[0]?.message ?? 'Invalid operation details',
      )
    }
    const envelope = envelopeResult.data
    if (envelope.confirmation !== policy.confirmation) {
      throw new OpsMutationValidationError(`Type “${policy.confirmation}” to confirm this action`)
    }
    if (policy.expectedVersion && envelope.expectedVersion === undefined) {
      throw new OpsMutationValidationError('The current resource version is required')
    }
    const resource = normalizeResource(resourceInput)
    const prismaClient = await this.databaseClientProvider.getClient()

    const existing = await prismaClient.opsMutationExecution.findUnique({
      where: { idempotencyKey: envelope.idempotencyKey },
    })
    if (existing) throw new OpsMutationReplayError(existing)

    try {
      return await prismaClient.$transaction(async (transaction) => {
        const execution = await transaction.opsMutationExecution.create({
          data: {
            action,
            actorUserId: principalUser.userId,
            confirmation: envelope.confirmation,
            expectedVersion: envelope.expectedVersion,
            idempotencyKey: envelope.idempotencyKey,
            reason: envelope.reason,
            reference: envelope.reference,
            resourceId: resource.id,
            resourceType: resource.type,
          },
        })
        await this.auditService.record(principalUser, {
          action: `${action}.requested`,
          metadata: {
            approvalClass: policy.approvalClass,
            expectedVersion: envelope.expectedVersion ?? null,
            mutationExecutionId: execution.id,
          },
          reason: envelope.reason,
          reference: envelope.reference,
          resourceId: resource.id,
          resourceType: resource.type,
        }, transaction)
        return {
          action,
          envelope,
          executionId: execution.id,
          policy,
          principal: principalUser,
          resource,
        }
      })
    }
    catch (error) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        const raced = await prismaClient.opsMutationExecution.findUnique({
          where: { idempotencyKey: envelope.idempotencyKey },
        })
        if (raced) throw new OpsMutationReplayError(raced)
      }
      throw error
    }
  }

  private async complete(
    context: OpsMutationContext,
    outcome: MutationOutcome,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    const prismaClient = transaction ?? await this.databaseClientProvider.getClient()
    const updated = await prismaClient.opsMutationExecution.updateMany({
      data: {
        completedAt: new Date(),
        resourceId: outcome.resourceId ?? context.resource.id,
        status: OpsMutationStatus.SUCCEEDED,
      },
      where: {
        id: context.executionId,
        status: OpsMutationStatus.REQUESTED,
      },
    })
    if (updated.count !== 1) {
      throw new OpsMutationReplayError({
        id: context.executionId,
        status: OpsMutationStatus.SUCCEEDED,
      })
    }
    await this.auditService.record(context.principal, {
      action: `${context.action}.succeeded`,
      metadata: {
        mutationExecutionId: context.executionId,
        ...(outcome.metadata ?? {}),
      },
      reason: context.envelope.reason,
      reference: context.envelope.reference,
      resourceId: outcome.resourceId ?? context.resource.id,
      resourceType: context.resource.type,
    }, transaction)
  }

  private async fail(context: OpsMutationContext, error: unknown): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const failureCode = errorCode(error)
    await prismaClient.$transaction(async (transaction) => {
      await transaction.opsMutationExecution.updateMany({
        data: {
          completedAt: new Date(),
          failureCode,
          status: OpsMutationStatus.FAILED,
        },
        where: {
          id: context.executionId,
          status: OpsMutationStatus.REQUESTED,
        },
      })
      await this.auditService.record(context.principal, {
        action: `${context.action}.failed`,
        metadata: {
          failureCode,
          mutationExecutionId: context.executionId,
        },
        reason: context.envelope.reason,
        reference: context.envelope.reference,
        resourceId: context.resource.id,
        resourceType: context.resource.type,
      }, transaction)
    })
  }
}
