import type { Prisma } from '@prisma/client'

import { OpsIncidentSeverity, OpsNoteKind, OpsRole, OpsWorkStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsIncidentContext, parseIncidentContext } from './contracts/OpsIncidentContracts'
import { OpsUserPrincipal, requireOpsPermission } from './opsIdentity'
import { getOpsRolePermissions } from './opsPermissions'

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100
const MAX_NOTE_LENGTH = 4_000
const MAX_HANDOFF_NOTE_LENGTH = 1_000
const MAX_TEAM_LENGTH = 60

const HANDOFF_PRIORITY_RANK: Readonly<Record<string, number>> = {
  CRITICAL: 4,
  HIGH: 3,
  INFO: 1,
  LOW: 1,
  NORMAL: 2,
  WARNING: 2,
}

const incidentSummaryInclude = {
  owner: { select: { displayName: true, id: true } },
  runbook: {
    select: { description: true, id: true, name: true, slug: true, url: true },
  },
} satisfies Prisma.OpsIncidentInclude

const incidentDetailInclude = {
  ...incidentSummaryInclude,
  handoffs: {
    include: {
      actor: { select: { displayName: true, id: true } },
      fromUser: { select: { displayName: true, id: true } },
      toUser: { select: { displayName: true, id: true } },
    },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    take: 100,
  },
  notes: {
    include: { author: { select: { displayName: true, id: true } } },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    take: 100,
  },
} satisfies Prisma.OpsIncidentInclude

export type OpsHandoffBoardDto = {
  counts: {
    mine: number
    total: number
    unowned: number
  }
  generatedAt: Date
  items: OpsHandoffWorkItemDto[]
  scope: OpsHandoffScope
}
export type OpsHandoffScope = 'ALL' | 'MINE' | 'UNOWNED'

export type OpsIncidentDetailDto = OpsIncidentSummaryDto & {
  handoffs: OpsIncidentHandoffDto[]
  notes: OpsIncidentNoteDto[]
}

export type OpsIncidentHandoffInput = {
  note: string
  toTeam?: null | string
  toUserId?: null | string
}

export type OpsIncidentListResponse = {
  items: OpsIncidentSummaryDto[]
  page: number
  pageSize: number
  severityCounts: OpsIncidentCountDto<OpsIncidentSeverity>[]
  statusCounts: OpsIncidentCountDto<OpsWorkStatus>[]
  total: number
}

export type OpsIncidentNoteInput = {
  body: string
  kind?: OpsNoteKind
}

export type OpsIncidentOverviewDto = {
  critical: number
  high: number
  open: number
  top: OpsIncidentSummaryDto[]
  unowned: number
}

export type OpsIncidentOwnerOptionDto = OpsIncidentUserDto & {
  role: OpsRole
}

export type OpsIncidentRunbookDto = {
  description: string
  id: string
  name: string
  slug: string
  url: string
}

export type OpsIncidentUpdateInput = {
  ownerUserId?: null | string
  runbookId?: null | string
  status?: OpsWorkStatus
  team?: null | string
}

type IncidentDetailRow = Prisma.OpsIncidentGetPayload<{ include: typeof incidentDetailInclude }>

type IncidentSummaryRow = Prisma.OpsIncidentGetPayload<{ include: typeof incidentSummaryInclude }>

type OpsHandoffWorkItemDto = {
  ageSeconds: number
  href: string
  id: string
  latestEscalation: null | {
    at: Date
    author: string
    summary: string
  }
  owner: null | OpsIncidentUserDto
  priority: string
  resourceType: 'CASE' | 'INCIDENT'
  status: OpsWorkStatus
  subtitle: string
  team: null | string
  title: string
  updatedAt: Date
  version: number
}

type OpsIncidentCountDto<TValue extends string> = {
  count: number
  value: TValue
}

type OpsIncidentHandoffDto = {
  actor: OpsIncidentUserDto
  createdAt: Date
  fromTeam: null | string
  fromUser: null | OpsIncidentUserDto
  id: string
  note: string
  toTeam: null | string
  toUser: null | OpsIncidentUserDto
}

type OpsIncidentListFilters = {
  kind?: string
  ownerUserId?: string
  page?: number
  pageSize?: number
  query?: string
  severity?: OpsIncidentSeverity
  status?: OpsWorkStatus
  team?: string
  unowned?: boolean
}

type OpsIncidentNoteDto = {
  author: OpsIncidentUserDto
  body: string
  createdAt: Date
  id: string
  kind: OpsNoteKind
}

type OpsIncidentSummaryDto = {
  acknowledgedAt: Date | null
  affectedCount: number
  ageSeconds: number
  context: OpsIncidentContext
  firstSeenAt: Date
  id: string
  kind: string
  lastSeenAt: Date
  occurrenceCount: number
  owner: null | OpsIncidentUserDto
  resolvedAt: Date | null
  runbook: null | OpsIncidentRunbookDto
  severity: OpsIncidentSeverity
  status: OpsWorkStatus
  summary: string
  team: null | string
  title: string
  updatedAt: Date
  version: number
}

type OpsIncidentUserDto = {
  displayName: string
  id: string
}

class OpsIncidentConflictError extends ApplicationError {
  public constructor(message = 'This incident changed after it was loaded; refresh before trying again') {
    super(409, 'ops_incident_conflict', message)
    this.name = 'OpsIncidentConflictError'
  }
}

class OpsIncidentNotFoundError extends ApplicationError {
  public constructor() {
    super(404, 'ops_incident_not_found', 'Operations incident not found')
    this.name = 'OpsIncidentNotFoundError'
  }
}

class OpsIncidentValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_incident_invalid', message)
    this.name = 'OpsIncidentValidationError'
  }
}

@injectable()
export class OpsIncidentService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async addNote(
    principal: OpsUserPrincipal,
    incidentId: string,
    input: OpsIncidentNoteInput,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsIncidentDetailDto> {
    requireOpsPermission(principal, 'incidents:manage')
    const body = input.body.trim()
    if (!body || body.length > MAX_NOTE_LENGTH) {
      throw new OpsIncidentValidationError(`Incident notes must be between 1 and ${MAX_NOTE_LENGTH} characters`)
    }
    const exists = await transaction.opsIncident.findUnique({ select: { id: true }, where: { id: incidentId } })
    if (!exists) throw new OpsIncidentNotFoundError()
    await transaction.opsIncidentNote.create({
      data: {
        authorUserId: principal.userId,
        body,
        incidentId,
        kind: input.kind ?? OpsNoteKind.NOTE,
      },
    })
    return this.requireDetail(transaction, incidentId)
  }

  public async getById(principal: OpsUserPrincipal, incidentId: string): Promise<OpsIncidentDetailDto> {
    requireOpsPermission(principal, 'incidents:read')
    const client = await this.databaseClientProvider.getClient()
    const row = await client.opsIncident.findUnique({
      include: incidentDetailInclude,
      where: { id: incidentId },
    })
    if (!row) throw new OpsIncidentNotFoundError()
    return this.toDetailDto(row)
  }

  public async getHandoffBoard(
    principal: OpsUserPrincipal,
    scope: OpsHandoffScope = 'ALL',
  ): Promise<OpsHandoffBoardDto> {
    requireOpsPermission(principal, 'incidents:read')
    const client = await this.databaseClientProvider.getClient()
    const unresolved = { not: OpsWorkStatus.RESOLVED }
    const [cases, incidents, mineCases, mineIncidents, unownedCases, unownedIncidents] = await Promise.all([
      client.opsCase.findMany({
        include: {
          notes: {
            include: { author: { select: { displayName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            where: { kind: OpsNoteKind.ESCALATION },
          },
          owner: { select: { displayName: true, id: true } },
          transaction: {
            select: {
              id: true,
              partnerUser: { select: { partner: { select: { name: true } } } },
              quote: { select: { targetCurrency: true } },
              status: true,
            },
          },
        },
        orderBy: [{ priority: 'desc' }, { updatedAt: 'asc' }],
        take: MAX_PAGE_SIZE,
        where: {
          status: unresolved,
          ...(scope === 'MINE' ? { ownerUserId: principal.userId } : {}),
          ...(scope === 'UNOWNED' ? { ownerUserId: null } : {}),
        },
      }),
      client.opsIncident.findMany({
        include: {
          notes: {
            include: { author: { select: { displayName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            where: { kind: OpsNoteKind.ESCALATION },
          },
          owner: { select: { displayName: true, id: true } },
        },
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
        take: MAX_PAGE_SIZE,
        where: {
          status: unresolved,
          ...(scope === 'MINE' ? { ownerUserId: principal.userId } : {}),
          ...(scope === 'UNOWNED' ? { ownerUserId: null } : {}),
        },
      }),
      client.opsCase.count({ where: { ownerUserId: principal.userId, status: unresolved } }),
      client.opsIncident.count({ where: { ownerUserId: principal.userId, status: unresolved } }),
      client.opsCase.count({ where: { ownerUserId: null, status: unresolved } }),
      client.opsIncident.count({ where: { ownerUserId: null, status: unresolved } }),
    ])
    const now = Date.now()
    const caseItems: OpsHandoffWorkItemDto[] = cases.map((opsCase) => {
      const escalation = opsCase.notes[0]
      return {
        ageSeconds: Math.max(0, Math.floor((now - opsCase.createdAt.getTime()) / 1_000)),
        href: `/ops/transactions/${encodeURIComponent(opsCase.transaction.id)}`,
        id: opsCase.id,
        latestEscalation: escalation
          ? {
              at: escalation.createdAt,
              author: escalation.author.displayName,
              summary: escalation.body,
            }
          : null,
        owner: opsCase.owner,
        priority: opsCase.priority,
        resourceType: 'CASE',
        status: opsCase.status,
        subtitle: `${opsCase.transaction.partnerUser.partner.name} · ${opsCase.transaction.quote.targetCurrency} · ${opsCase.transaction.status}`,
        team: opsCase.team,
        title: `Transaction case ${opsCase.transaction.id.slice(0, 8)}`,
        updatedAt: opsCase.updatedAt,
        version: opsCase.version,
      }
    })
    const incidentItems: OpsHandoffWorkItemDto[] = incidents.map((incident) => {
      const escalation = incident.notes[0]
      return {
        ageSeconds: Math.max(0, Math.floor((now - incident.firstSeenAt.getTime()) / 1_000)),
        href: `/ops/incidents/${encodeURIComponent(incident.id)}`,
        id: incident.id,
        latestEscalation: escalation
          ? {
              at: escalation.createdAt,
              author: escalation.author.displayName,
              summary: escalation.body,
            }
          : null,
        owner: incident.owner,
        priority: incident.severity,
        resourceType: 'INCIDENT',
        status: incident.status,
        subtitle: `${incident.kind} · ${incident.affectedCount} affected`,
        team: incident.team,
        title: incident.title,
        updatedAt: incident.updatedAt,
        version: incident.version,
      }
    })
    const items = [...incidentItems, ...caseItems]
      .sort((left, right) => (
        (HANDOFF_PRIORITY_RANK[right.priority] ?? 0) - (HANDOFF_PRIORITY_RANK[left.priority] ?? 0)
        || left.updatedAt.getTime() - right.updatedAt.getTime()
      ))
      .slice(0, MAX_PAGE_SIZE)
    return {
      counts: {
        mine: mineCases + mineIncidents,
        total: caseItems.length + incidentItems.length,
        unowned: unownedCases + unownedIncidents,
      },
      generatedAt: new Date(),
      items,
      scope,
    }
  }

  public async getOverview(principal: OpsUserPrincipal): Promise<OpsIncidentOverviewDto> {
    requireOpsPermission(principal, 'incidents:read')
    return this.getOverviewInternal()
  }

  public async getOverviewInternal(): Promise<OpsIncidentOverviewDto> {
    const client = await this.databaseClientProvider.getClient()
    const unresolved = { not: OpsWorkStatus.RESOLVED }
    const [open, critical, high, unowned, top] = await Promise.all([
      client.opsIncident.count({ where: { status: unresolved } }),
      client.opsIncident.count({ where: { severity: OpsIncidentSeverity.CRITICAL, status: unresolved } }),
      client.opsIncident.count({ where: { severity: OpsIncidentSeverity.HIGH, status: unresolved } }),
      client.opsIncident.count({ where: { ownerUserId: null, status: unresolved } }),
      client.opsIncident.findMany({
        include: incidentSummaryInclude,
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
        take: 5,
        where: { status: unresolved },
      }),
    ])
    return { critical, high, open, top: top.map(row => this.toSummaryDto(row)), unowned }
  }

  public async handoff(
    principal: OpsUserPrincipal,
    incidentId: string,
    input: OpsIncidentHandoffInput,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsIncidentDetailDto> {
    requireOpsPermission(principal, 'incidents:manage')
    const note = input.note.trim()
    if (!note || note.length > MAX_HANDOFF_NOTE_LENGTH) {
      throw new OpsIncidentValidationError(`Handoff note must be between 1 and ${MAX_HANDOFF_NOTE_LENGTH} characters`)
    }
    const toTeam = this.normalizeTeam(input.toTeam)
    const toUserId = input.toUserId?.trim() || null
    if (!toTeam && !toUserId) {
      throw new OpsIncidentValidationError('Select an individual or team to receive the incident')
    }
    await this.assertOwner(transaction, toUserId)
    const current = await transaction.opsIncident.findUnique({
      select: { ownerUserId: true, team: true, version: true },
      where: { id: incidentId },
    })
    if (!current) throw new OpsIncidentNotFoundError()
    if (current.version !== expectedVersion) throw new OpsIncidentConflictError()
    const updated = await transaction.opsIncident.updateMany({
      data: { ownerUserId: toUserId, team: toTeam, version: { increment: 1 } },
      where: { id: incidentId, version: expectedVersion },
    })
    if (updated.count !== 1) throw new OpsIncidentConflictError()
    await transaction.opsHandoff.create({
      data: {
        actorUserId: principal.userId,
        fromTeam: current.team,
        fromUserId: current.ownerUserId,
        incidentId,
        note,
        resourceType: 'INCIDENT',
        toTeam,
        toUserId,
      },
    })
    return this.requireDetail(transaction, incidentId)
  }

  public async list(
    principal: OpsUserPrincipal,
    filters: OpsIncidentListFilters,
  ): Promise<OpsIncidentListResponse> {
    requireOpsPermission(principal, 'incidents:read')
    const client = await this.databaseClientProvider.getClient()
    const page = Math.max(1, Math.trunc(filters.page ?? 1))
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(filters.pageSize ?? DEFAULT_PAGE_SIZE)))
    const baseWhere = this.buildWhere({ ...filters, status: undefined })
    const where = this.buildWhere(filters)
    const [items, total, statusGroups, severityGroups] = await Promise.all([
      client.opsIncident.findMany({
        include: incidentSummaryInclude,
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      client.opsIncident.count({ where }),
      client.opsIncident.groupBy({
        _count: { _all: true },
        by: ['status'],
        orderBy: { status: 'asc' },
        where: baseWhere,
      }),
      client.opsIncident.groupBy({
        _count: { _all: true },
        by: ['severity'],
        orderBy: { severity: 'asc' },
        where: this.buildWhere({ ...filters, severity: undefined }),
      }),
    ])
    return {
      items: items.map(row => this.toSummaryDto(row)),
      page,
      pageSize,
      severityCounts: Object.values(OpsIncidentSeverity).map(value => ({
        count: severityGroups.find(group => group.severity === value)?._count._all ?? 0,
        value,
      })),
      statusCounts: Object.values(OpsWorkStatus).map(value => ({
        count: statusGroups.find(group => group.status === value)?._count._all ?? 0,
        value,
      })),
      total,
    }
  }

  public async listOwners(principal: OpsUserPrincipal): Promise<OpsIncidentOwnerOptionDto[]> {
    requireOpsPermission(principal, 'incidents:read')
    const roles = Object.values(OpsRole).filter(role => getOpsRolePermissions(role).includes('incidents:manage'))
    const client = await this.databaseClientProvider.getClient()
    return client.opsUser.findMany({
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { displayName: true, id: true, role: true },
      where: { disabledAt: null, role: { in: roles } },
    })
  }

  public async listRunbooks(principal: OpsUserPrincipal): Promise<OpsIncidentRunbookDto[]> {
    requireOpsPermission(principal, 'incidents:read')
    const client = await this.databaseClientProvider.getClient()
    return client.opsRunbook.findMany({
      orderBy: { name: 'asc' },
      select: { description: true, id: true, name: true, slug: true, url: true },
      where: { active: true },
    })
  }

  public async update(
    principal: OpsUserPrincipal,
    incidentId: string,
    input: OpsIncidentUpdateInput,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsIncidentDetailDto> {
    requireOpsPermission(principal, 'incidents:manage')
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new OpsIncidentValidationError('The current incident version is required')
    }
    if (
      input.ownerUserId === undefined
      && input.runbookId === undefined
      && input.status === undefined
      && input.team === undefined
    ) {
      throw new OpsIncidentValidationError('Select at least one incident field to update')
    }
    const ownerUserId = input.ownerUserId === undefined ? undefined : input.ownerUserId?.trim() || null
    const runbookId = input.runbookId === undefined ? undefined : input.runbookId?.trim() || null
    const team = input.team === undefined ? undefined : this.normalizeTeam(input.team)
    await this.assertOwner(transaction, ownerUserId)
    await this.assertRunbook(transaction, runbookId)
    const now = new Date()
    const updated = await transaction.opsIncident.updateMany({
      data: {
        ...(input.status === undefined
          ? {}
          : {
              acknowledgedAt: input.status === OpsWorkStatus.ACKNOWLEDGED ? now : null,
              resolvedAt: input.status === OpsWorkStatus.RESOLVED ? now : null,
              status: input.status,
            }),
        ...(ownerUserId === undefined ? {} : { ownerUserId }),
        ...(runbookId === undefined ? {} : { runbookId }),
        ...(team === undefined ? {} : { team }),
        version: { increment: 1 },
      },
      where: { id: incidentId, version: expectedVersion },
    })
    if (updated.count !== 1) {
      const exists = await transaction.opsIncident.findUnique({ select: { id: true }, where: { id: incidentId } })
      if (!exists) throw new OpsIncidentNotFoundError()
      throw new OpsIncidentConflictError()
    }
    return this.requireDetail(transaction, incidentId)
  }

  private async assertOwner(transaction: Prisma.TransactionClient, ownerUserId: null | string | undefined): Promise<void> {
    if (!ownerUserId) return
    const owner = await transaction.opsUser.findFirst({
      select: { role: true },
      where: { disabledAt: null, id: ownerUserId },
    })
    if (!owner || !getOpsRolePermissions(owner.role).includes('incidents:manage')) {
      throw new OpsIncidentValidationError('Incident owner must be an enabled user with incident-management access')
    }
  }

  private async assertRunbook(transaction: Prisma.TransactionClient, runbookId: null | string | undefined): Promise<void> {
    if (!runbookId) return
    const runbook = await transaction.opsRunbook.findFirst({ select: { id: true }, where: { active: true, id: runbookId } })
    if (!runbook) throw new OpsIncidentValidationError('Select an active incident runbook')
  }

  private buildWhere(filters: OpsIncidentListFilters): Prisma.OpsIncidentWhereInput {
    const query = filters.query?.trim().slice(0, 120)
    const kind = filters.kind?.trim().slice(0, 60)
    const team = filters.team?.trim().slice(0, MAX_TEAM_LENGTH)
    return {
      ...(kind ? { kind } : {}),
      ...(filters.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(team ? { team } : {}),
      ...(filters.unowned ? { ownerUserId: null } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { summary: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
  }

  private normalizeTeam(value: null | string | undefined): null | string {
    const team = value?.trim() || null
    if (team && team.length > MAX_TEAM_LENGTH) {
      throw new OpsIncidentValidationError(`Team must be at most ${MAX_TEAM_LENGTH} characters`)
    }
    return team
  }

  private async requireDetail(
    transaction: Prisma.TransactionClient,
    incidentId: string,
  ): Promise<OpsIncidentDetailDto> {
    const row = await transaction.opsIncident.findUnique({
      include: incidentDetailInclude,
      where: { id: incidentId },
    })
    if (!row) throw new OpsIncidentNotFoundError()
    return this.toDetailDto(row)
  }

  private toDetailDto(row: IncidentDetailRow): OpsIncidentDetailDto {
    return {
      ...this.toSummaryDto(row),
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
      notes: row.notes.map(note => ({
        author: note.author,
        body: note.body,
        createdAt: note.createdAt,
        id: note.id,
        kind: note.kind,
      })),
    }
  }

  private toSummaryDto(row: IncidentSummaryRow): OpsIncidentSummaryDto {
    return {
      acknowledgedAt: row.acknowledgedAt,
      affectedCount: row.affectedCount,
      ageSeconds: Math.max(0, Math.floor((Date.now() - row.firstSeenAt.getTime()) / 1_000)),
      context: parseIncidentContext(row.context),
      firstSeenAt: row.firstSeenAt,
      id: row.id,
      kind: row.kind,
      lastSeenAt: row.lastSeenAt,
      occurrenceCount: row.occurrenceCount,
      owner: row.owner,
      resolvedAt: row.resolvedAt,
      runbook: row.runbook,
      severity: row.severity,
      status: row.status,
      summary: row.summary,
      team: row.team,
      title: row.title,
      updatedAt: row.updatedAt,
      version: row.version,
    }
  }
}
