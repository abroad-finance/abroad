// src/environment/CachedSecretManager.ts
import { GcpSecretManager } from "./GcpSecretManager";
import { ISecretManager, Secret } from "../interfaces/ISecretManager";

export class CachedSecretManager implements ISecretManager {
  private cache = new Map<string, string>();
  private decoratedSecretManager: ISecretManager;

  constructor() {
    this.decoratedSecretManager = new GcpSecretManager();
  }

  /**
   * Returns a cached secret if available, otherwise fetches it using the underlying secret manager.
   */
  async getSecret(secretName: Secret): Promise<string> {
    if (this.cache.has(secretName)) {
      return this.cache.get(secretName)!;
    }
    const secret = await this.decoratedSecretManager.getSecret(secretName);
    this.cache.set(secretName, secret);
    return secret;
  }
}
