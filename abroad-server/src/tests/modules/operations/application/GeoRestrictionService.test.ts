import 'reflect-metadata'

import type { Prisma, PrismaClient } from '@prisma/client'

import { OpsRole } from '@prisma/client'

import type { ILogger } from '../../../../core/logging/types'

import { GEO_RESTRICTION_SETTING_ID, GeoRestrictionService, GeoRestrictionValidationError } from '../../../../modules/operations/application/GeoRestrictionService'
import { OpsAuthorizationError, OpsUserPrincipal } from '../../../../modules/operations/application/opsIdentity'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const updatedAt = new Date('2026-08-13T12:00:00.000Z')

const principalWith = (permissions: OpsUserPrincipal['permissions']): OpsUserPrincipal => ({
  authTime: new Date(),
  displayName: 'Administrator',
  email: 'admin@abroad.finance',
  kind: 'ops_user',
  permissions,
  role: OpsRole.ADMINISTRATOR,
  sessionVersion: 1,
  userId: 'admin-1',
})

const manager = principalWith(['configuration:manage', 'configuration:read'])
const reader = principalWith(['configuration:read'])

type SettingRow = {
  enabled: boolean
  id: string
  updatedAt: Date
  version: number
}

const buildHarness = (enabled = true) => {
  const row = { enabled, updatedAt, version: 3 }
  const prisma = {
    geoRestrictionSetting: {
      findUnique: jest.fn(async (): Promise<null | SettingRow> => (
        { ...row, id: GEO_RESTRICTION_SETTING_ID }
      )),
      updateMany: jest.fn(async ({ data }: { data: { enabled: boolean } }) => {
        row.enabled = data.enabled
        row.version += 1
        return { count: 1 }
      }),
    },
  }
  const logger: ILogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return {
    logger,
    prisma,
    row,
    service: new GeoRestrictionService(provider, logger),
    transaction: prisma as unknown as Prisma.TransactionClient,
  }
}

describe('GeoRestrictionService', () => {
  it('blocks a restricted country while the gate is enabled', async () => {
    const harness = buildHarness(true)

    await expect(harness.service.isCountryBlocked('US')).resolves.toBe(true)
  })

  it('stops blocking the restricted country once the gate is disabled', async () => {
    const harness = buildHarness(false)

    await expect(harness.service.isCountryBlocked('US')).resolves.toBe(false)
  })

  it('never blocks an unrestricted or unresolved country', async () => {
    const harness = buildHarness(true)

    await expect(harness.service.isCountryBlocked('CO')).resolves.toBe(false)
    await expect(harness.service.isCountryBlocked(null)).resolves.toBe(false)
    // An unresolved country short-circuits before the setting is ever read.
    expect(harness.prisma.geoRestrictionSetting.findUnique).not.toHaveBeenCalled()
  })

  it('serves the enforced default when the setting row is missing', async () => {
    const harness = buildHarness(true)
    harness.prisma.geoRestrictionSetting.findUnique.mockResolvedValue(null)

    await expect(harness.service.isCountryBlocked('US')).resolves.toBe(true)
  })

  it('caches the decision instead of reading on every request', async () => {
    const harness = buildHarness(true)

    await harness.service.isCountryBlocked('US')
    await harness.service.isCountryBlocked('US')

    expect(harness.prisma.geoRestrictionSetting.findUnique).toHaveBeenCalledTimes(1)
  })

  it('keeps the last known value when the database read fails', async () => {
    const harness = buildHarness(false)
    await expect(harness.service.isCountryBlocked('US')).resolves.toBe(false)

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    harness.prisma.geoRestrictionSetting.findUnique.mockRejectedValue(new Error('connection lost'))
    try {
      await expect(harness.service.isCountryBlocked('US')).resolves.toBe(false)
    }
    finally {
      jest.spyOn(Date, 'now').mockRestore()
    }
    expect(harness.logger.warn).toHaveBeenCalled()
  })

  it('falls back to enforcing the gate when no read has ever succeeded', async () => {
    const harness = buildHarness(true)
    harness.prisma.geoRestrictionSetting.findUnique.mockRejectedValue(new Error('connection lost'))

    await expect(harness.service.isCountryBlocked('US')).resolves.toBe(true)
  })

  it('updates the setting and reports the code-owned restricted countries', async () => {
    const harness = buildHarness(true)

    const result = await harness.service.updateSetting(manager, false, 3, harness.transaction)

    expect(harness.prisma.geoRestrictionSetting.updateMany).toHaveBeenCalledWith({
      data: { enabled: false, updatedByUserId: 'admin-1', version: { increment: 1 } },
      where: { id: GEO_RESTRICTION_SETTING_ID, version: 3 },
    })
    expect(result).toEqual({
      enabled: false,
      restrictedCountries: ['US'],
      updatedAt,
      version: 4,
    })
  })

  it('serves the new value immediately after an update rather than the cached one', async () => {
    const harness = buildHarness(true)
    await expect(harness.service.isCountryBlocked('US')).resolves.toBe(true)

    await harness.service.updateSetting(manager, false, 3, harness.transaction)

    await expect(harness.service.isCountryBlocked('US')).resolves.toBe(false)
  })

  it('rejects an update whose expected version no longer matches', async () => {
    const harness = buildHarness(true)
    harness.prisma.geoRestrictionSetting.updateMany.mockResolvedValue({ count: 0 })

    await expect(harness.service.updateSetting(manager, false, 2, harness.transaction))
      .rejects.toThrow('The region restriction changed after it was loaded; refresh before trying again')
  })

  it('rejects an update carrying no usable version', async () => {
    const harness = buildHarness(true)

    await expect(harness.service.updateSetting(manager, false, 0, harness.transaction))
      .rejects.toBeInstanceOf(GeoRestrictionValidationError)
    expect(harness.prisma.geoRestrictionSetting.updateMany).not.toHaveBeenCalled()
  })

  it('refuses to update without configuration:manage', async () => {
    const harness = buildHarness(true)

    await expect(harness.service.updateSetting(reader, false, 3, harness.transaction))
      .rejects.toBeInstanceOf(OpsAuthorizationError)
    expect(harness.prisma.geoRestrictionSetting.updateMany).not.toHaveBeenCalled()
  })

  it('refuses to read without configuration:read', async () => {
    const harness = buildHarness(true)

    await expect(harness.service.getSetting(principalWith(['transactions:read'])))
      .rejects.toBeInstanceOf(OpsAuthorizationError)
    expect(harness.prisma.geoRestrictionSetting.findUnique).not.toHaveBeenCalled()
  })

  it('reads the setting uncached so an operator always sees the current version', async () => {
    const harness = buildHarness(true)

    await harness.service.getSetting(reader)
    await harness.service.getSetting(reader)

    expect(harness.prisma.geoRestrictionSetting.findUnique).toHaveBeenCalledTimes(2)
  })
})
