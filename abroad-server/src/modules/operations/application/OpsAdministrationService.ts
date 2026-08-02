import type { OpsAuditEvent, OpsUser, Prisma } from '@prisma/client'

import { OpsRole, Prisma as PrismaNamespace } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { getOpsRolePermissions } from './opsPermissions'

const OPS_EMAIL_DOMAIN = 'abroad.finance'
const MAX_PAGE_SIZE = 100

export type OpsUserInviteInput = {
  displayName: string
  email: string
  role: OpsRole
}

export type OpsUserRoleUpdateInput = {
  role: OpsRole
}

export const opsUserInviteSchema: z.ZodType<OpsUserInviteInput> = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.nativeEnum(OpsRole),
}).strict()

export const opsUserRoleUpdateSchema: z.ZodType<OpsUserRoleUpdateInput> = z.object({
  role: z.nativeEnum(OpsRole),
}).strict()

export type OpsAuditEventDto = {
  action: string
  actorKind: string
  actorLabel: string
  actorUserId: null | string
  createdAt: Date
  id: string
  metadata: null | Record<string, boolean | null | number | string>
  reason: null | string
  reference: null | string
  resourceId: null | string
  resourceType: string
}

export type OpsAuditListDto = {
  items: OpsAuditEventDto[]
  page: number
  pageSize: number
  total: number
}

export type OpsAuditQuery = {
  action?: string
  actor?: string
  createdFrom?: Date
  createdTo?: Date
  page: number
  pageSize: number
  resourceId?: string
  resourceType?: string
}

export type OpsUserDto = {
  createdAt: Date
  disabledAt: Date | null
  displayName: string
  email: string
  id: string
  lastLoginAt: Date | null
  permissions: string[]
  role: OpsRole
  sessionsRevokedAt: Date | null
  sessionVersion: number
  status: 'ACTIVE' | 'DISABLED' | 'INVITED'
  updatedAt: Date
  version: number
}

export type OpsUserListDto = {
  items: OpsUserDto[]
}

type UserMutationOptions = {
  data: Prisma.OpsUserUpdateManyMutationInput
  expectedVersion: number
  userId: string
  validate?: (transaction: Prisma.TransactionClient, user: OpsUser) => Promise<void>
}

export class OpsAdministrationConflictError extends ApplicationError {
  public constructor(message = 'This Ops user changed after it was loaded') {
    super(409, 'ops_administration_conflict', message)
    this.name = 'OpsAdministrationConflictError'
  }
}

export class OpsAdministrationNotFoundError extends ApplicationError {
  public constructor() {
    super(404, 'ops_user_not_found', 'Ops user not found')
    this.name = 'OpsAdministrationNotFoundError'
  }
}

export class OpsAdministrationValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_administration_invalid', message)
    this.name = 'OpsAdministrationValidationError'
  }
}

@injectable()
export class OpsAdministrationService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async disableUser(
    userId: string,
    expectedVersion: number,
    actorUserId: string,
  ): Promise<OpsUserDto> {
    return this.mutateUser({
      data: {
        disabledAt: new Date(),
        sessionsRevokedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
      expectedVersion,
      userId,
      validate: async (transaction, user) => {
        if (user.id === actorUserId) {
          throw new OpsAdministrationValidationError('You cannot disable your own Ops account')
        }
        await this.assertAdministratorContinuity(transaction, user, null)
      },
    })
  }

  public async enableUser(
    userId: string,
    expectedVersion: number,
  ): Promise<OpsUserDto> {
    return this.mutateUser({
      data: {
        disabledAt: null,
        sessionsRevokedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
      expectedVersion,
      userId,
    })
  }

  public async inviteUser(input: OpsUserInviteInput): Promise<OpsUserDto> {
    const parsed = opsUserInviteSchema.safeParse(input)
    if (!parsed.success) {
      throw new OpsAdministrationValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid Ops user invitation',
      )
    }
    this.assertOrganizationEmail(parsed.data.email)
    const prismaClient = await this.databaseClientProvider.getClient()
    try {
      const user = await prismaClient.opsUser.create({
        data: {
          displayName: parsed.data.displayName,
          email: parsed.data.email,
          role: parsed.data.role,
        },
      })
      return this.toUserDto(user)
    }
    catch (error) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        throw new OpsAdministrationConflictError('An Ops user with this email already exists')
      }
      throw error
    }
  }

  public async listAuditEvents(query: OpsAuditQuery): Promise<OpsAuditListDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const page = Math.max(1, query.page)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize))
    const where: Prisma.OpsAuditEventWhereInput = {
      action: query.action ? { contains: query.action, mode: 'insensitive' } : undefined,
      actorLabel: query.actor ? { contains: query.actor, mode: 'insensitive' } : undefined,
      createdAt: query.createdFrom || query.createdTo
        ? { gte: query.createdFrom, lte: query.createdTo }
        : undefined,
      resourceId: query.resourceId ? { contains: query.resourceId } : undefined,
      resourceType: query.resourceType
        ? { contains: query.resourceType, mode: 'insensitive' }
        : undefined,
    }
    const [items, total] = await Promise.all([
      prismaClient.opsAuditEvent.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      prismaClient.opsAuditEvent.count({ where }),
    ])

    return {
      items: items.map(event => this.toAuditDto(event)),
      page,
      pageSize,
      total,
    }
  }

  public async listUsers(): Promise<OpsUserListDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const users = await prismaClient.opsUser.findMany({
      orderBy: [{ disabledAt: 'asc' }, { displayName: 'asc' }, { email: 'asc' }],
    })
    return { items: users.map(user => this.toUserDto(user)) }
  }

  public async revokeSessions(
    userId: string,
    expectedVersion: number,
  ): Promise<OpsUserDto> {
    return this.mutateUser({
      data: {
        sessionsRevokedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
      expectedVersion,
      userId,
    })
  }

  public async updateRole(
    userId: string,
    role: OpsRole,
    expectedVersion: number,
  ): Promise<OpsUserDto> {
    return this.mutateUser({
      data: {
        role,
        sessionsRevokedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
      expectedVersion,
      userId,
      validate: (transaction, user) => this.assertAdministratorContinuity(
        transaction,
        user,
        role,
      ),
    })
  }

  private async assertAdministratorContinuity(
    transaction: Prisma.TransactionClient,
    user: OpsUser,
    nextRole: null | OpsRole,
  ): Promise<void> {
    if (user.disabledAt || user.role !== OpsRole.ADMINISTRATOR || nextRole === OpsRole.ADMINISTRATOR) {
      return
    }
    const activeAdministratorCount = await transaction.opsUser.count({
      where: { disabledAt: null, role: OpsRole.ADMINISTRATOR },
    })
    if (activeAdministratorCount <= 1) {
      throw new OpsAdministrationValidationError('At least one enabled Ops administrator is required')
    }
  }

  private assertOrganizationEmail(email: string): void {
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
    if (domain !== OPS_EMAIL_DOMAIN) {
      throw new OpsAdministrationValidationError('Ops access is limited to abroad.finance accounts')
    }
  }

  private async mutateUser(options: UserMutationOptions): Promise<OpsUserDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    return prismaClient.$transaction(async (transaction) => {
      const user = await transaction.opsUser.findUnique({ where: { id: options.userId } })
      if (!user) throw new OpsAdministrationNotFoundError()
      if (user.version !== options.expectedVersion) {
        throw new OpsAdministrationConflictError()
      }
      await options.validate?.(transaction, user)
      const update = await transaction.opsUser.updateMany({
        data: {
          ...options.data,
          version: { increment: 1 },
        },
        where: { id: options.userId, version: options.expectedVersion },
      })
      if (update.count !== 1) throw new OpsAdministrationConflictError()
      const updated = await transaction.opsUser.findUnique({ where: { id: options.userId } })
      if (!updated) throw new OpsAdministrationNotFoundError()
      return this.toUserDto(updated)
    }, {
      isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable,
    })
  }

  private safeMetadata(
    metadata: null | Prisma.JsonValue,
  ): null | Record<string, boolean | null | number | string> {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null
    return Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
      if (
        value === null
        || typeof value === 'boolean'
        || typeof value === 'number'
        || typeof value === 'string'
      ) {
        return [key, value]
      }
      return [key, '[structured]']
    }))
  }

  private toAuditDto(event: OpsAuditEvent): OpsAuditEventDto {
    return {
      action: event.action,
      actorKind: event.actorKind,
      actorLabel: event.actorLabel,
      actorUserId: event.actorUserId,
      createdAt: event.createdAt,
      id: event.id,
      metadata: this.safeMetadata(event.metadata),
      reason: event.reason,
      reference: event.reference,
      resourceId: event.resourceId,
      resourceType: event.resourceType,
    }
  }

  private toUserDto(user: OpsUser): OpsUserDto {
    return {
      createdAt: user.createdAt,
      disabledAt: user.disabledAt,
      displayName: user.displayName,
      email: user.email,
      id: user.id,
      lastLoginAt: user.lastLoginAt,
      permissions: [...getOpsRolePermissions(user.role)],
      role: user.role,
      sessionsRevokedAt: user.sessionsRevokedAt,
      sessionVersion: user.sessionVersion,
      status: user.disabledAt
        ? 'DISABLED'
        : user.firebaseUid
          ? 'ACTIVE'
          : 'INVITED',
      updatedAt: user.updatedAt,
      version: user.version,
    }
  }
}
