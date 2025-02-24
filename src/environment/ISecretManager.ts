// src/environment/ISecretManager.ts

export type Secret =
  | "PROJECT_ID"
  | "stellar-account-id"
  | "horizon-url"
  | "RABBITMQ_URL"
  | "DATABASE_URL"
  | "ACCESS_KEY_NEQUI"
  | "SECRET_KEY_NEQUI"
  | "API_KEY_NEQUI"
  | "DISPERSION_CODE_NEQUI"
  | "URL_NEQUI"
  | "URL_NEQUI_AUTH";

export interface ISecretManager {
  getSecret(secretName: Secret): Promise<string>;
}
