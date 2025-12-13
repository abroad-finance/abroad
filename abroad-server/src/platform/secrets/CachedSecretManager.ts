// src/platform/secrets/CachedSecretManager.ts
import { injectable } from 'inversify'

import { RuntimeConfig } from '../../app/config/runtime'
import { GcpSecretManager } from './GcpSecretManager'
import { ISecretManager, Secret } from './ISecretManager'

type CachedSecret = {
  expiresAt: number
  value: string
}

@injectable()
export class CachedSecretManager implements ISecretManager {
  private cache = new Map<string, CachedSecret>()
  private readonly cacheTtlMs: number
  private decoratedSecretManager: ISecretManager

  constructor(cacheTtlMs = RuntimeConfig.secrets.cacheTtlMs) {
    this.decoratedSecretManager = new GcpSecretManager()
    this.cacheTtlMs = cacheTtlMs
  }

  /**
   * Returns a cached secret if available, otherwise fetches it using the underlying secret manager.
   */
  async getSecret(secretName: Secret): Promise<string> {
    const cached = this.cache.get(secretName)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const secret = await this.decoratedSecretManager.getSecret(secretName)
    this.cache.set(secretName, { expiresAt: Date.now() + this.cacheTtlMs, value: secret })
    return secret
  }

  getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    return Promise.all(secretNames.map(name => this.getSecret(name)))
      .then((secrets) => {
        const result: Record<string, string> = {}
        secretNames.forEach((name, index) => {
          result[name] = secrets[index]
        })
        return result as Record<T[number], string>
      })
  }
}
