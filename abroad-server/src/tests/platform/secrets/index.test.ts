import { CachedSecretManager } from '../../../platform/secrets'

describe('environment index', () => {
  it('exposes CachedSecretManager', () => {
    expect(CachedSecretManager).toBeDefined()
  })
})
