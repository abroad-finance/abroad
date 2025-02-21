// src/environment/ISecretManager.ts

export type Secret = 'PROJECT_ID' | "stellar-account-id" | "horizon-url" | "RABBITMQ_URL" | "DATABASE_URL";

export interface ISecretManager {
    getSecret(secretName: Secret): Promise<string>;
  }
  