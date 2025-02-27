// src/environment/ISecretManager.ts

export type Secret =
  | "ACCESS_KEY_NEQUI"
  | "API_KEY_NEQUI"
  | "BITSO_API_KEY"
  | "DATABASE_URL"
  | "DISPERSION_CODE_NEQUI"
  | "horizon-url"
  | "RABBITMQ_URL"
  | "SECRET_KEY_NEQUI"
  | "stellar-account-id"
  | "URL_NEQUI"
  | "URL_NEQUI_AUTH";

export interface ISecretManager {
  getSecret(secretName: Secret): Promise<string>;
}
