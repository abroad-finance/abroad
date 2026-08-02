import type { Prisma } from '@prisma/client'

import {
  OpsNoteKind,
  OpsPriority,
  OpsRole,
  OpsWorkStatus,
  Prisma as PrismaNamespace,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsUserPrincipal, requireOpsPermission } from './opsIdentity'
import { getOpsRolePermissions } from './opsPermissions'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_NOTE_LENGTH = 4_000
const MAX_HANDOFF_NOTE_LENGTH = 1_000
const MAX_TEAM_LENGTH = 60

const caseInclude = {
  handoffs: {
    include: {
      actor: { select: { displayName: true, id: true } },
      fromUser: { select: { displayName: true, id: true } },
      toUser: { select: { displayName: true, id: true } },
    },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  notes: {
    include: { author: { select: { displayName: true, id: true } } },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  owner: { select: { displayName: true, id: true } },
  transaction: {
    include: {
      partnerUser: { select: { partner: { select: { id: true, name: true } } } },
      quote: true,
    },
  },
} satisfies Prisma.OpsCaseInclude

export type OpsCaseCreateInput = {
  ownerUserId?: string
  priority?: OpsPriority
  team?: string
  transactionId: string
}

export type OpsCaseDto = {
  createdAt: Date
  handoffs: OpsCaseHandoffDto[]
  id: string
  notes: OpsCaseNoteDto[]
  owner: null | OpsCaseUserDto
  priority: OpsPriority
  resolvedAt: Date | null
  status: OpsWorkStatus
  team: null | string
  transaction: {
    createdAt: Date
    id: string
    partner: { id: string, name: string }
    sourceAmount: number
    sourceCurrency: string
    status: string
    targetAmount: number
    targetCurrency: string
  }
  updatedAt: Date
  version: number
}

export type OpsCaseHandoffDto = {
  actor: OpsCaseUserDto
  createdAt: Date
  fromTeam: null | string
  fromUser: null | OpsCaseUserDto
  id: string
  note: string
  toTeam: null | string
  toUser: null | OpsCaseUserDto
}

export type OpsCaseHandoffInput = {
  note: string
  toTeam?: null | string
  toUserId?: null | string
}

export type OpsCaseListFilters = {
  ownerUserId?: string
  page?: number
  pageSize?: number
  priority?: OpsPriority
  status?: OpsWorkStatus
  team?: string
  transactionId?: string
}

export type OpsCaseListResponse = {
  items: OpsCaseDto[]
  page: number
  pageSize: number
  total: number
}

export type OpsCaseNoteDto = {
  author: OpsCaseUserDto
  body: string
  createdAt: Date
  id: string
  kind: OpsNoteKind
}

export type OpsCaseNoteInput = {
  body: string
  kind?: OpsNoteKind
}

export type OpsCaseOwnerOptionDto = OpsCaseUserDto & {
  role: OpsRole
}

export type OpsCaseUpdateInput = {
  ownerUserId?: null | string
  priority?: OpsPriority
  status?: OpsWorkStatus
  team?: null | string
}

export type OpsCaseUserDto = {
  displayName: string
  id: string
}

type CaseRow = Prisma.OpsCaseGetPayload<{ include: typeof caseInclude }>

export class OpsCaseConflictError extends ApplicationError {
  public constructor(message = 'This case changed after it was loaded; refresh before trying again') {
    super(409, 'ops_case_conflict', message)
    this.name = 'OpsCaseConflictError'
  }
}

export class OpsCaseNotFoundError extends ApplicationError {
  public constructor(message = 'Operations case not found') {
    super(404, 'ops_case_not_found', message)
    this.name = 'OpsCaseNotFoundError'
  }
}

export class OpsCaseValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_case_invalid', message)
    this.name = 'OpsCaseValidationError'
  }
}

@injectable()
export class OpsCaseService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async addNote(
    principal: OpsUserPrincipal,
    caseId: string,
    input: OpsCaseNoteInput,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsCaseDto> {
    requireOpsPermission(principal, 'cases:manage')
    const body = input.body.trim()
    if (!body || body.length > MAX_NOTE_LENGTH) {
      throw new OpsCaseValidationError(`Case notes must be between 1 and ${MAX_NOTE_LENGTH} characters`)
    }
    const existing = await transaction.opsCase.findUnique({
      select: { id: true, status: true },
      where: { id: caseId },
    })
    if (!existing) throw new OpsCaseNotFoundError()
    const kind = input.kind ?? OpsNoteKind.NOTE
    if (kind === OpsNoteKind.RESOLUTION && existing.status !== OpsWorkStatus.RESOLVED) {
      throw new OpsCaseValidationError('Resolve the case before adding a resolution note')
    }
    await transaction.opsCaseNote.create({
      data: {
        authorUserId: principal.userId,
        body,
        caseId,
        kind,
      },
    })
    return this.requireCase(transaction, caseId)
  }

  public async create(
    principal: OpsUserPrincipal,
    input: OpsCaseCreateInput,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsCaseDto> {
    requireOpsPermission(principal, 'cases:manage')
    const transactionId = input.transactionId.trim()
    if (!transactionId) throw new OpsCaseValidationError('Transaction is required')
    const team = this.normalizeTeam(input.team)
    await this.assertOwner(transaction, input.ownerUserId)
    const source = await transaction.transaction.findUnique({ select: { id: true }, where: { id: transactionId } })
    if (!source) throw new OpsCaseValidationError('Transaction was not found')
    try {
      const created = await transaction.opsCase.create({
        data: {
          ownerUserId: input.ownerUserId,
          priority: input.priority ?? OpsPriority.NORMAL,
          team,
          transactionId,
        },
        select: { id: true },
      })
      return this.requireCase(transaction, created.id)
    }
    catch (error) {
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OpsCaseConflictError('A case already exists for this transaction')
      }
      throw error
    }
  }

  public async getById(principal: OpsUserPrincipal, caseId: string): Promise<OpsCaseDto> {
    requireOpsPermission(principal, 'transactions:read')
    const prismaClient = await this.databaseClientProvider.getClient()
    return this.requireCase(prismaClient, caseId)
  }

  public async handoff(
    principal: OpsUserPrincipal,
    caseId: string,
    input: OpsCaseHandoffInput,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsCaseDto> {
    requireOpsPermission(principal, 'cases:manage')
    const note = input.note.trim()
    if (!note || note.length > MAX_HANDOFF_NOTE_LENGTH) {
      throw new OpsCaseValidationError(`Handoff notes must be between 1 and ${MAX_HANDOFF_NOTE_LENGTH} characters`)
    }
    const toTeam = input.toTeam === null ? null : this.normalizeTeam(input.toTeam)
    await this.assertOwner(transaction, input.toUserId ?? undefined)
    const current = await transaction.opsCase.findUnique({
      select: { ownerUserId: true, team: true },
      where: { id: caseId },
    })
    if (!current) throw new OpsCaseNotFoundError()
    if (input.toUserId === undefined && input.toTeam === undefined) {
      throw new OpsCaseValidationError('Choose a new owner or team for the handoff')
    }
    const updated = await transaction.opsCase.updateMany({
      data: {
        ...(input.toUserId !== undefined ? { ownerUserId: input.toUserId } : {}),
        ...(input.toTeam !== undefined ? { team: toTeam } : {}),
        version: { increment: 1 },
      },
      where: { id: caseId, version: expectedVersion },
    })
    if (updated.count !== 1) throw new OpsCaseConflictError()
    await transaction.opsHandoff.create({
      data: {
        actorUserId: principal.userId,
        caseId,
        fromTeam: current.team,
        fromUserId: current.ownerUserId,
        note,
        resourceType: 'CASE',
        toTeam: input.toTeam !== undefined ? toTeam : current.team,
        toUserId: input.toUserId !== undefined ? input.toUserId : current.ownerUserId,
      },
    })
    return this.requireCase(transaction, caseId)
  }

  public async list(
    principal: OpsUserPrincipal,
    filters: OpsCaseListFilters,
  ): Promise<OpsCaseListResponse> {
    requireOpsPermission(principal, 'transactions:read')
    const page = this.normalizePage(filters.page)
    const pageSize = this.normalizePageSize(filters.pageSize)
    const where: Prisma.OpsCaseWhereInput = {
      ownerUserId: filters.ownerUserId,
      priority: filters.priority,
      status: filters.status,
      team: filters.team?.trim() || undefined,
      transactionId: filters.transactionId?.trim() || undefined,
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    const [rows, total] = await Promise.all([
      prismaClient.opsCase.findMany({
        include: caseInclude,
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      prismaClient.opsCase.count({ where }),
    ])
    return { items: rows.map(row => this.toDto(row)), page, pageSize, total }
  }

  public async listOwners(principal: OpsUserPrincipal): Promise<OpsCaseOwnerOptionDto[]> {
    requireOpsPermission(principal, 'transactions:read')
    const prismaClient = await this.databaseClientProvider.getClient()
    const users = await prismaClient.opsUser.findMany({
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { displayName: true, id: true, role: true },
      where: { disabledAt: null },
    })
    return users.filter(user => getOpsRolePermissions(user.role).includes('cases:manage'))
  }

  public async update(
    principal: OpsUserPrincipal,
    caseId: string,
    input: OpsCaseUpdateInput,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsCaseDto> {
    requireOpsPermission(principal, 'cases:manage')
    if (
      input.ownerUserId === undefined
      && input.priority === undefined
      && input.status === undefined
      && input.team === undefined
    ) throw new OpsCaseValidationError('Choose at least one case field to update')
    await this.assertOwner(transaction, input.ownerUserId ?? undefined)
    const team = input.team === null ? null : this.normalizeTeam(input.team)
    const updated = await transaction.opsCase.updateMany({
      data: {
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined
          ? {
              resolvedAt: input.status === OpsWorkStatus.RESOLVED ? new Date() : null,
              status: input.status,
            }
          : {}),
        ...(input.team !== undefined ? { team } : {}),
        version: { increment: 1 },
      },
      where: { id: caseId, version: expectedVersion },
    })
    if (updated.count !== 1) {
      const exists = await transaction.opsCase.count({ where: { id: caseId } })
      if (exists === 0) throw new OpsCaseNotFoundError()
      throw new OpsCaseConflictError()
    }
    return this.requireCase(transaction, caseId)
  }

  private async assertOwner(
    transaction: Prisma.TransactionClient,
    ownerUserId: string | undefined,
  ): Promise<void> {
    if (!ownerUserId) return
    const user = await transaction.opsUser.findUnique({
      select: { disabledAt: true, role: true },
      where: { id: ownerUserId },
    })
    if (!user || user.disabledAt || !getOpsRolePermissions(user.role).includes('cases:manage')) {
      throw new OpsCaseValidationError('The selected owner cannot manage transaction cases')
    }
  }

  private normalizePage(value: number | undefined): number {
    const page = value ?? 1
    if (!Number.isInteger(page) || page < 1) throw new OpsCaseValidationError('Page must be a positive integer')
    return page
  }

  private normalizePageSize(value: number | undefined): number {
    const pageSize = value ?? DEFAULT_PAGE_SIZE
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new OpsCaseValidationError(`Page size must be between 1 and ${MAX_PAGE_SIZE}`)
    }
    return pageSize
  }

  private normalizeTeam(value: null | string | undefined): null | string {
    const team = value?.trim()
    if (!team) return null
    if (team.length > MAX_TEAM_LENGTH) {
      throw new OpsCaseValidationError(`Team must be ${MAX_TEAM_LENGTH} characters or fewer`)
    }
    return team
  }

  private async requireCase(
    prismaClient: import('@prisma/client').PrismaClient | Prisma.TransactionClient,
    caseId: string,
  ): Promise<OpsCaseDto> {
    const row = await prismaClient.opsCase.findUnique({ include: caseInclude, where: { id: caseId } })
    if (!row) throw new OpsCaseNotFoundError()
    return this.toDto(row)
  }

  private toDto(row: CaseRow): OpsCaseDto {
    return {
      createdAt: row.createdAt,
      handoffs: row.handoffs.map(handoff => ({
        actor: handoff.actor,
        createdAt: handoff.createdAt,
        fromTeam: handoff.fromTeam,
        fromUser: handoff.fromUser,
        id: handoff.id,
        note: handoff.note,
        toTeam: handoff.toTeam,
        toUser: handoff.toUser,
      })),
      id: row.id,
      notes: row.notes.map(note => ({
        author: note.author,
        body: note.body,
        createdAt: note.createdAt,
        id: note.id,
        kind: note.kind,
      })),
      owner: row.owner,
      priority: row.priority,
      resolvedAt: row.resolvedAt,
      status: row.status,
      team: row.team,
      transaction: {
        createdAt: row.transaction.createdAt,
        id: row.transaction.id,
        partner: row.transaction.partnerUser.partner,
        sourceAmount: row.transaction.quote.sourceAmount,
        sourceCurrency: row.transaction.quote.cryptoCurrency,
        status: row.transaction.status,
        targetAmount: row.transaction.quote.targetAmount,
        targetCurrency: row.transaction.quote.targetCurrency,
      },
      updatedAt: row.updatedAt,
      version: row.version,
    }
  }
}
