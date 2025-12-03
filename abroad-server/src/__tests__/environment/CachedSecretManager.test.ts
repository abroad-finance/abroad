import type { Secret } from '../../interfaces/ISecretManager'

import { CachedSecretManager } from '../../environment/CachedSecretManager'
import { Secrets } from '../../interfaces/ISecretManager'

const getSecretMock = jest.fn<Promise<string>, [Secret]>()

jest.mock('../../environment/GcpSecretManager', () => ({
  GcpSecretManager: jest.fn(() => ({
    getSecret: (secretName: Secret) => getSecretMock(secretName),
  })),
}))

describe('CachedSecretManager', () => {
  beforeEach(() => {
    getSecretMock.mockReset()
  })

  it('retrieves a secret once and returns cached values on subsequent calls', async () => {
    getSecretMock.mockResolvedValueOnce('postgres://cached-url')
    const manager = new CachedSecretManager()

    const first = await manager.getSecret(Secrets.DATABASE_URL)
    const second = await manager.getSecret(Secrets.DATABASE_URL)

    expect(first).toBe('postgres://cached-url')
    expect(second).toBe('postgres://cached-url')
    expect(getSecretMock).toHaveBeenCalledTimes(1)
  })

  it('reuses cached secrets when fetching multiple values', async () => {
    getSecretMock
      .mockResolvedValueOnce('postgres://cached-url')
      .mockResolvedValueOnce('redis://cache')

    const manager = new CachedSecretManager()
    await manager.getSecret(Secrets.DATABASE_URL)

    const secrets = await manager.getSecrets([Secrets.DATABASE_URL, Secrets.REDIS_URL] as const)

    expect(secrets).toEqual({
      DATABASE_URL: 'postgres://cached-url',
      REDIS_URL: 'redis://cache',
    })
    expect(getSecretMock).toHaveBeenCalledTimes(2)
  })
})
