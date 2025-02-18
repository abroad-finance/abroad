// src/environment/ISecretManager.ts
export interface ISecretManager {
    getSecret(secretName: string): Promise<string>;
  }
  