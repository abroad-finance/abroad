import type { PrismaClient } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../platform/secrets/ISecretManager'

import { OpsAuthService } from '../../../app/http/OpsAuthService'
import { OpsAuthenticationError } from '../../../modules/operations/application/opsIdentity'
import { OPS_PERMISSIONS } from '../../../modules/operations/application/opsPermissions'

const buildService = (administratorCount: number) => {
  const count = jest.fn().mockResolvedValue(administratorCount)
  const prismaClient = { opsUser: { count } } as unknown as PrismaClient
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn().mockResolvedValue(prismaClient),
  }
  const getSecret = jest.fn().mockResolvedValue('expected-ops-key')
  const secretManager = { getSecret } as unknown as ISecretManager

  return {
    count,
    getSecret,
    service: new OpsAuthService(secretManager, databaseClientProvider),
  }
}

describe('OpsAuthService', () => {
  it('allows full bootstrap permissions only before an administrator exists', async () => {
    const { service } = buildService(0)

    const principal = await service.authenticateLegacyApiKey('expected-ops-key')

    expect(principal.kind).toBe('ops_legacy')
    expect(principal.permissions).toEqual(OPS_PERMISSIONS)
  })

  it('reduces the legacy key to read-only access after administrator bootstrap', async () => {
    const { service } = buildService(1)

    const principal = await service.authenticateLegacyApiKey('expected-ops-key')

    expect(principal.permissions).toContain('overview:read')
    expect(principal.permissions).toContain('transactions:read')
    expect(principal.permissions).not.toContain('transactions:reconcile')
    expect(principal.permissions).not.toContain('configuration:manage')
  })

  it.each([
    'short',
    'unexpected-key--',
  ])('rejects an invalid key without querying the user store', async (providedKey) => {
    const { count, service } = buildService(0)

    await expect(service.authenticateLegacyApiKey(providedKey)).rejects.toBeInstanceOf(
      OpsAuthenticationError,
    )
    expect(count).not.toHaveBeenCalled()
  })
})
