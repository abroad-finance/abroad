import { CachedSecretManager } from '../../environment'

describe('environment index', () => {
  it('exposes CachedSecretManager', () => {
    expect(CachedSecretManager).toBeDefined()
  })
})
