import type { Prisma } from '@prisma/client'

import { OpsRole, OpsSavedViewResource, OpsSavedViewScope, Prisma as PrismaNamespace } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsUserPrincipal, requireOpsPermission } from './opsIdentity'

const MAX_NAME_LENGTH = 80

const savedViewFiltersSchema = z.object({
  attention: z.string().trim().max(80).optional(),
  blockchain: z.string().trim().max(80).optional(),
  caseOwnerId: z.string().trim().max(200).optional(),
  caseStatus: z.string().trim().max(80).optional(),
  createdFrom: z.string().trim().max(20).optional(),
  createdTo: z.string().trim().max(20).optional(),
  cryptoCurrency: z.string().trim().max(40).optional(),
  failure: z.string().trim().max(80).optional(),
  failureCategory: z.string().trim().max(80).optional(),
  kind: z.string().trim().max(80).optional(),
  network: z.string().trim().max(80).optional(),
  onChainId: z.string().trim().max(200).optional(),
  ownerUserId: z.string().trim().max(200).optional(),
  pageSize: z.number().int().min(10).max(100).optional(),
  partnerId: z.string().trim().max(200).optional(),
  paymentMethod: z.string().trim().max(80).optional(),
  payoutProvider: z.string().trim().max(80).optional(),
  priority: z.string().trim().max(80).optional(),
  proofStatus: z.string().trim().max(80).optional(),
  provider: z.string().trim().max(80).optional(),
  query: z.string().trim().max(200).optional(),
  refundStatus: z.string().trim().max(80).optional(),
  severity: z.string().trim().max(80).optional(),
  status: z.string().trim().max(80).optional(),
  stuckMinutes: z.number().int().min(1).max(43_200).optional(),
  targetCurrency: z.string().trim().max(40).optional(),
  team: z.string().trim().max(60).optional(),
  transactionId: z.string().trim().max(200).optional(),
  unowned: z.boolean().optional(),
  venue: z.string().trim().max(80).optional(),
  webhookStatus: z.string().trim().max(80).optional(),
}).strict()

export type OpsSavedViewCreateInput = {
  filters: OpsSavedViewFiltersDto
  name: string
  resource: OpsSavedViewResource
  scope?: OpsSavedViewScope
}

export type OpsSavedViewDto = {
  createdAt: Date
  filters: OpsSavedViewFiltersDto
  id: string
  name: string
  owner: { displayName: string, id: string }
  resource: OpsSavedViewResource
  scope: OpsSavedViewScope
  updatedAt: Date
  version: number
}

export type OpsSavedViewFiltersDto = {
  attention?: string
  blockchain?: string
  caseOwnerId?: string
  caseStatus?: string
  createdFrom?: string
  createdTo?: string
  cryptoCurrency?: string
  failure?: string
  failureCategory?: string
  kind?: string
  network?: string
  onChainId?: string
  ownerUserId?: string
  pageSize?: number
  partnerId?: string
  paymentMethod?: string
  payoutProvider?: string
  priority?: string
  proofStatus?: string
  provider?: string
  query?: string
  refundStatus?: string
  severity?: string
  status?: string
  stuckMinutes?: number
  targetCurrency?: string
  team?: string
  transactionId?: string
  unowned?: boolean
  venue?: string
  webhookStatus?: string
}

export type OpsSavedViewUpdateInput = {
  filters?: OpsSavedViewFiltersDto
  name?: string
  scope?: OpsSavedViewScope
}

export class OpsSavedViewConflictError extends ApplicationError {
  public constructor(message = 'This saved view changed after it was loaded; refresh before trying again') {
    super(409, 'ops_saved_view_conflict', message)
    this.name = 'OpsSavedViewConflictError'
  }
}

export class OpsSavedViewNotFoundError extends ApplicationError {
  public constructor() {
    super(404, 'ops_saved_view_not_found', 'Saved view not found')
    this.name = 'OpsSavedViewNotFoundError'
  }
}

export class OpsSavedViewValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_saved_view_invalid', message)
    this.name = 'OpsSavedViewValidationError'
  }
}

@injectable()
export class OpsSavedViewService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async create(
    principal: OpsUserPrincipal,
    input: OpsSavedViewCreateInput,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsSavedViewDto> {
    requireOpsPermission(principal, 'saved_views:manage')
    const name = this.normalizeName(input.name)
    const filters = this.normalizeFilters(input.filters)
    try {
      const created = await transaction.opsSavedView.create({
        data: {
          filters,
          name,
          ownerUserId: principal.userId,
          resource: input.resource,
          scope: input.scope ?? OpsSavedViewScope.PRIVATE,
        },
        include: { owner: { select: { displayName: true, id: true } } },
      })
      return this.toDto(created)
    }
    catch (error) {
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OpsSavedViewConflictError('You already have a saved view with this name')
      }
      throw error
    }
  }

  public async delete(
    principal: OpsUserPrincipal,
    viewId: string,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    requireOpsPermission(principal, 'saved_views:manage')
    const existing = await this.requireWritable(transaction, principal, viewId)
    const deleted = await transaction.opsSavedView.deleteMany({
      where: { id: existing.id, version: expectedVersion },
    })
    if (deleted.count !== 1) throw new OpsSavedViewConflictError()
    return { id: existing.id }
  }

  public async list(
    principal: OpsUserPrincipal,
    resource?: OpsSavedViewResource,
  ): Promise<OpsSavedViewDto[]> {
    requireOpsPermission(principal, 'transactions:read')
    const prismaClient = await this.databaseClientProvider.getClient()
    const rows = await prismaClient.opsSavedView.findMany({
      include: { owner: { select: { displayName: true, id: true } } },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      where: {
        OR: [
          { ownerUserId: principal.userId },
          { scope: OpsSavedViewScope.TEAM },
        ],
        resource,
      },
    })
    return rows.map(row => this.toDto(row))
  }

  public async update(
    principal: OpsUserPrincipal,
    viewId: string,
    input: OpsSavedViewUpdateInput,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsSavedViewDto> {
    requireOpsPermission(principal, 'saved_views:manage')
    if (input.filters === undefined && input.name === undefined && input.scope === undefined) {
      throw new OpsSavedViewValidationError('Choose at least one saved-view field to update')
    }
    const existing = await this.requireWritable(transaction, principal, viewId)
    try {
      const updated = await transaction.opsSavedView.updateMany({
        data: {
          ...(input.filters !== undefined ? { filters: this.normalizeFilters(input.filters) } : {}),
          ...(input.name !== undefined ? { name: this.normalizeName(input.name) } : {}),
          ...(input.scope !== undefined ? { scope: input.scope } : {}),
          version: { increment: 1 },
        },
        where: { id: existing.id, version: expectedVersion },
      })
      if (updated.count !== 1) throw new OpsSavedViewConflictError()
      const row = await transaction.opsSavedView.findUnique({
        include: { owner: { select: { displayName: true, id: true } } },
        where: { id: viewId },
      })
      if (!row) throw new OpsSavedViewNotFoundError()
      return this.toDto(row)
    }
    catch (error) {
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OpsSavedViewConflictError('You already have a saved view with this name')
      }
      throw error
    }
  }

  private normalizeFilters(input: OpsSavedViewFiltersDto): Prisma.InputJsonObject {
    const result = savedViewFiltersSchema.safeParse(input)
    if (!result.success) {
      throw new OpsSavedViewValidationError(result.error.issues[0]?.message ?? 'Saved-view filters are invalid')
    }
    return Object.fromEntries(
      Object.entries(result.data).filter((entry): entry is [string, number | string] => entry[1] !== undefined),
    )
  }

  private normalizeName(value: string): string {
    const name = value.trim().replace(/\s+/g, ' ')
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new OpsSavedViewValidationError(`Saved-view names must be between 1 and ${MAX_NAME_LENGTH} characters`)
    }
    return name
  }

  private async requireWritable(
    transaction: Prisma.TransactionClient,
    principal: OpsUserPrincipal,
    viewId: string,
  ): Promise<{ id: string }> {
    const row = await transaction.opsSavedView.findUnique({
      select: { id: true, ownerUserId: true },
      where: { id: viewId },
    })
    if (!row || (row.ownerUserId !== principal.userId && principal.role !== OpsRole.ADMINISTRATOR)) {
      throw new OpsSavedViewNotFoundError()
    }
    return row
  }

  private toDto(row: {
    createdAt: Date
    filters: Prisma.JsonValue
    id: string
    name: string
    owner: { displayName: string, id: string }
    resource: OpsSavedViewResource
    scope: OpsSavedViewScope
    updatedAt: Date
    version: number
  }): OpsSavedViewDto {
    const filters = savedViewFiltersSchema.safeParse(row.filters)
    return {
      createdAt: row.createdAt,
      filters: filters.success ? filters.data : {},
      id: row.id,
      name: row.name,
      owner: row.owner,
      resource: row.resource,
      scope: row.scope,
      updatedAt: row.updatedAt,
      version: row.version,
    }
  }
}
