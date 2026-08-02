import type { Prisma } from '@prisma/client'

import { Prisma as PrismaNamespace } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsUserPrincipal, requireOpsPermission } from '../../operations/application/opsIdentity'

const CODE_PATTERN = /^[A-Z0-9_]{2,40}$/
const MAX_TEAM_LENGTH = 60
const MAX_THRESHOLD = 1_000_000_000_000

const thresholdInclude = {
  createdBy: { select: { displayName: true, id: true } },
  updatedBy: { select: { displayName: true, id: true } },
} satisfies Prisma.OpsTreasuryThresholdInclude

export type OpsTreasuryThresholdDto = {
  createdAt: Date
  createdBy: { displayName: string, id: string }
  criticalRunwayHours: null | number
  currency: string
  id: string
  minimumAvailable: null | number
  ownerTeam: string
  updatedAt: Date
  updatedBy: { displayName: string, id: string }
  venue: string
  version: number
  warningRunwayHours: null | number
}

export type OpsTreasuryThresholdInput = {
  criticalRunwayHours?: null | number
  currency: string
  minimumAvailable?: null | number
  ownerTeam: string
  venue: string
  warningRunwayHours?: null | number
}

type ThresholdRow = Prisma.OpsTreasuryThresholdGetPayload<{ include: typeof thresholdInclude }>

export class OpsTreasuryThresholdConflictError extends ApplicationError {
  public constructor(message = 'This treasury threshold changed after it was loaded; refresh before trying again') {
    super(409, 'ops_treasury_threshold_conflict', message)
    this.name = 'OpsTreasuryThresholdConflictError'
  }
}

export class OpsTreasuryThresholdNotFoundError extends ApplicationError {
  public constructor() {
    super(404, 'ops_treasury_threshold_not_found', 'Treasury threshold not found')
    this.name = 'OpsTreasuryThresholdNotFoundError'
  }
}

export class OpsTreasuryThresholdValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_treasury_threshold_invalid', message)
    this.name = 'OpsTreasuryThresholdValidationError'
  }
}

@injectable()
export class OpsTreasuryThresholdService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async create(
    principal: OpsUserPrincipal,
    input: OpsTreasuryThresholdInput,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsTreasuryThresholdDto> {
    requireOpsPermission(principal, 'treasury:manage')
    const normalized = this.validateInput(input)
    try {
      const row = await transaction.opsTreasuryThreshold.create({
        data: {
          ...normalized,
          createdByUserId: principal.userId,
          updatedByUserId: principal.userId,
        },
        include: thresholdInclude,
      })
      return this.toDto(row)
    }
    catch (error) {
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OpsTreasuryThresholdConflictError('A threshold already exists for this venue and currency')
      }
      throw error
    }
  }

  public async list(principal: OpsUserPrincipal): Promise<OpsTreasuryThresholdDto[]> {
    requireOpsPermission(principal, 'treasury:read')
    const client = await this.databaseClientProvider.getClient()
    const rows = await client.opsTreasuryThreshold.findMany({
      include: thresholdInclude,
      orderBy: [{ venue: 'asc' }, { currency: 'asc' }],
    })
    return rows.map(row => this.toDto(row))
  }

  public async update(
    principal: OpsUserPrincipal,
    thresholdId: string,
    input: OpsTreasuryThresholdInput,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsTreasuryThresholdDto> {
    requireOpsPermission(principal, 'treasury:manage')
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new OpsTreasuryThresholdValidationError('The current threshold version is required')
    }
    const normalized = this.validateInput(input)
    const updated = await transaction.opsTreasuryThreshold.updateMany({
      data: {
        ...normalized,
        updatedByUserId: principal.userId,
        version: { increment: 1 },
      },
      where: { id: thresholdId, version: expectedVersion },
    })
    if (updated.count !== 1) {
      const exists = await transaction.opsTreasuryThreshold.findUnique({
        select: { id: true },
        where: { id: thresholdId },
      })
      if (!exists) throw new OpsTreasuryThresholdNotFoundError()
      throw new OpsTreasuryThresholdConflictError()
    }
    const row = await transaction.opsTreasuryThreshold.findUnique({
      include: thresholdInclude,
      where: { id: thresholdId },
    })
    if (!row) throw new OpsTreasuryThresholdNotFoundError()
    return this.toDto(row)
  }

  private normalizeOptionalThreshold(value: null | number | undefined, label: string): null | number {
    if (value === null || value === undefined) return null
    if (!Number.isFinite(value) || value < 0 || value > MAX_THRESHOLD) {
      throw new OpsTreasuryThresholdValidationError(`${label} must be between 0 and ${MAX_THRESHOLD}`)
    }
    return value
  }

  private toDto(row: ThresholdRow): OpsTreasuryThresholdDto {
    return {
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      criticalRunwayHours: row.criticalRunwayHours,
      currency: row.currency,
      id: row.id,
      minimumAvailable: row.minimumAvailable,
      ownerTeam: row.ownerTeam,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      venue: row.venue,
      version: row.version,
      warningRunwayHours: row.warningRunwayHours,
    }
  }

  private validateInput(input: OpsTreasuryThresholdInput): Omit<
    OpsTreasuryThresholdInput,
    'criticalRunwayHours' | 'minimumAvailable' | 'warningRunwayHours'
  > & {
    criticalRunwayHours: null | number
    minimumAvailable: null | number
    warningRunwayHours: null | number
  } {
    const venue = input.venue.trim().toUpperCase()
    const currency = input.currency.trim().toUpperCase()
    const ownerTeam = input.ownerTeam.trim()
    if (!CODE_PATTERN.test(venue)) {
      throw new OpsTreasuryThresholdValidationError('Venue must be a supported uppercase operational code')
    }
    if (!CODE_PATTERN.test(currency)) {
      throw new OpsTreasuryThresholdValidationError('Currency must be a supported uppercase asset code')
    }
    if (!ownerTeam || ownerTeam.length > MAX_TEAM_LENGTH) {
      throw new OpsTreasuryThresholdValidationError(`Owner team must be between 1 and ${MAX_TEAM_LENGTH} characters`)
    }
    const minimumAvailable = this.normalizeOptionalThreshold(input.minimumAvailable, 'Minimum available')
    const warningRunwayHours = this.normalizeOptionalThreshold(input.warningRunwayHours, 'Warning runway')
    const criticalRunwayHours = this.normalizeOptionalThreshold(input.criticalRunwayHours, 'Critical runway')
    if (minimumAvailable === null && warningRunwayHours === null && criticalRunwayHours === null) {
      throw new OpsTreasuryThresholdValidationError('Configure at least one available-balance or runway threshold')
    }
    if (
      warningRunwayHours !== null
      && criticalRunwayHours !== null
      && criticalRunwayHours > warningRunwayHours
    ) {
      throw new OpsTreasuryThresholdValidationError('Critical runway must not exceed warning runway')
    }
    return {
      criticalRunwayHours,
      currency,
      minimumAvailable,
      ownerTeam,
      venue,
      warningRunwayHours,
    }
  }
}
