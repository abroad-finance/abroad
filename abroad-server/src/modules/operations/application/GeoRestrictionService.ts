import type { Prisma } from '@prisma/client'

import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { toError } from '../../../core/errors/toError'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsUserPrincipal, requireOpsPermission } from './opsIdentity'

// The gate is global, so its state lives in a single well-known row.
export const GEO_RESTRICTION_SETTING_ID = 'global'

// Countries the gate refuses while it is enabled. The list is deliberately
// code-owned: changing which countries are restricted is a legal decision that
// belongs in review, while turning the gate off is an operational one.
const RESTRICTED_COUNTRIES: readonly string[] = ['US']

// The gate is enforced on an unauthenticated path hit by every page load, so
// the setting is cached rather than read per request. This is also the upper
// bound on how long a toggle takes to reach every serving instance.
const CACHE_TTL_MS = 30_000

// While the database is unreachable the last known value is reused, but only
// for short windows, so recovery is quick without retrying on every request.
const CACHE_FAILURE_BACKOFF_MS = 5_000

// Applied when this instance has never completed a read. The gate is a
// compliance control, so its default must be restrictive.
const DEFAULT_ENABLED = true

export type GeoRestrictionSettingDto = {
  enabled: boolean
  restrictedCountries: string[]
  updatedAt: Date
  version: number
}

export type GeoRestrictionUpdateInput = {
  enabled: boolean
}

type GeoRestrictionRow = {
  enabled: boolean
  updatedAt: Date
  version: number
}

class GeoRestrictionConflictError extends ApplicationError {
  public constructor() {
    super(
      409,
      'geo_restriction_conflict',
      'The region restriction changed after it was loaded; refresh before trying again',
    )
    this.name = 'GeoRestrictionConflictError'
  }
}

class GeoRestrictionNotFoundError extends ApplicationError {
  public constructor() {
    super(404, 'geo_restriction_not_found', 'The region restriction setting is not provisioned')
    this.name = 'GeoRestrictionNotFoundError'
  }
}

export class GeoRestrictionValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'geo_restriction_invalid', message)
    this.name = 'GeoRestrictionValidationError'
  }
}

@injectable()
export class GeoRestrictionService {
  private cache: null | { enabled: boolean, expiresAt: number } = null

  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
  ) {}

  public async getSetting(principal: OpsUserPrincipal): Promise<GeoRestrictionSettingDto> {
    requireOpsPermission(principal, 'configuration:read')
    const client = await this.databaseClientProvider.getClient()
    const row = await client.geoRestrictionSetting.findUnique({
      select: this.settingSelect(),
      where: { id: GEO_RESTRICTION_SETTING_ID },
    })
    if (!row) throw new GeoRestrictionNotFoundError()
    return this.toDto(row)
  }

  /**
   * Decides whether a resolved country is currently refused. An unresolved
   * country is never blocked: the gate fails open on lookup failure so a
   * geolocation gap cannot lock out legitimate regions.
   */
  public async isCountryBlocked(country: null | string): Promise<boolean> {
    if (country === null || !RESTRICTED_COUNTRIES.includes(country)) return false
    return this.isEnabled()
  }

  public async updateSetting(
    principal: OpsUserPrincipal,
    enabled: boolean,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<GeoRestrictionSettingDto> {
    requireOpsPermission(principal, 'configuration:manage')
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new GeoRestrictionValidationError('The current resource version is required')
    }
    const result = await transaction.geoRestrictionSetting.updateMany({
      data: {
        enabled,
        updatedByUserId: principal.userId,
        version: { increment: 1 },
      },
      where: { id: GEO_RESTRICTION_SETTING_ID, version: expectedVersion },
    })
    if (result.count !== 1) {
      const exists = await transaction.geoRestrictionSetting.findUnique({
        select: { id: true },
        where: { id: GEO_RESTRICTION_SETTING_ID },
      })
      if (!exists) throw new GeoRestrictionNotFoundError()
      throw new GeoRestrictionConflictError()
    }
    const row = await transaction.geoRestrictionSetting.findUnique({
      select: this.settingSelect(),
      where: { id: GEO_RESTRICTION_SETTING_ID },
    })
    if (!row) throw new GeoRestrictionNotFoundError()
    // Dropping the cache rather than seeding it keeps this correct if the
    // surrounding mutation transaction rolls back: the next read goes to the
    // database instead of trusting a write that never landed.
    this.cache = null
    return this.toDto(row)
  }

  private async isEnabled(): Promise<boolean> {
    const now = Date.now()
    if (this.cache && this.cache.expiresAt > now) return this.cache.enabled
    try {
      const client = await this.databaseClientProvider.getClient()
      const row = await client.geoRestrictionSetting.findUnique({
        select: { enabled: true },
        where: { id: GEO_RESTRICTION_SETTING_ID },
      })
      const enabled = row?.enabled ?? DEFAULT_ENABLED
      this.cache = { enabled, expiresAt: now + CACHE_TTL_MS }
      return enabled
    }
    catch (error) {
      // A database failure must not silently lift a compliance control, so the
      // last known value stands in; the restrictive default applies when this
      // instance has never read one.
      const enabled = this.cache?.enabled ?? DEFAULT_ENABLED
      this.logger.warn('Geo restriction setting read failed; serving last known value', toError(error))
      this.cache = { enabled, expiresAt: now + CACHE_FAILURE_BACKOFF_MS }
      return enabled
    }
  }

  private settingSelect() {
    return { enabled: true, updatedAt: true, version: true } as const
  }

  private toDto(row: GeoRestrictionRow): GeoRestrictionSettingDto {
    return {
      enabled: row.enabled,
      restrictedCountries: [...RESTRICTED_COUNTRIES],
      updatedAt: row.updatedAt,
      version: row.version,
    }
  }
}
