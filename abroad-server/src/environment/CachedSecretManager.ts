// src/environment/CachedSecretManager.ts
import { injectable } from 'inversify'

import { ISecretManager, Secret } from '../interfaces/ISecretManager'
import { GcpSecretManager } from './GcpSecretManager'

@injectable()
export class CachedSecretManager implements ISecretManager {
  private cache = new Map<string, string>()
  private decoratedSecretManager: ISecretManager

  constructor() {
    this.decoratedSecretManager = new GcpSecretManager()
  }

  /**
   * Returns a cached secret if available, otherwise fetches it using the underlying secret manager.
   */
  async getSecret(secretName: Secret): Promise<string> {
    if (this.cache.has(secretName)) {
      return this.cache.get(secretName)!
    }
    const secret = await this.decoratedSecretManager.getSecret(secretName)
    this.cache.set(secretName, secret)
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
