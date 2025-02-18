// src/environment/CachedSecretManager.ts
import { ISecretManager } from './ISecretManager';

export class CachedSecretManager implements ISecretManager {
  private cache = new Map<string, string>();
  private decoratedSecretManager: ISecretManager;

  constructor(secretManager: ISecretManager) {
    this.decoratedSecretManager = secretManager;
  }

  /**
   * Returns a cached secret if available, otherwise fetches it using the underlying secret manager.
   */
  async getSecret(secretName: string): Promise<string> {
    if (this.cache.has(secretName)) {
      return this.cache.get(secretName)!;
    }
    const secret = await this.decoratedSecretManager.getSecret(secretName);
    this.cache.set(secretName, secret);
    return secret;
  }
}
