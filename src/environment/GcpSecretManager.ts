// src/environment/GcpSecretManager.ts
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { isAvailable, project } from "gcp-metadata";
import { ISecretManager } from "../interfaces/ISecretManager";
import dotenv from "dotenv";

dotenv.config();

export class GcpSecretManager implements ISecretManager {
  private secretClient: SecretManagerServiceClient;
  private cachedProjectId: string | null = null;

  constructor() {
    this.secretClient = new SecretManagerServiceClient();
  }

  /**
   * Retrieves the project ID from environment or metadata.
   */
  private async getProjectId(): Promise<string | null> {
    if (this.cachedProjectId) {
      return this.cachedProjectId;
    }

    if (process.env.NODE_ENV === "development") {
      if (!process.env.PROJECT_ID) {
        throw new Error("PROJECT_ID is not defined in development mode.");
      }
      return process.env.PROJECT_ID;
    }

    if (await isAvailable()) {
      this.cachedProjectId = await project("project-id");
      return this.cachedProjectId;
    } else {
      throw new Error("GCP not available");
    }
  }

  /**
   * Fetches the secret from GCP Secret Manager or from environment variables in development.
   */
  async getSecret(secretName: string): Promise<string> {
    // In development, attempt to fetch from process.env.
    if (process.env.NODE_ENV === "development") {
      const secretValue = process.env[secretName];
      if (secretValue) {
        return secretValue;
      }
    }

    // Fetch secret from GCP Secret Manager.
    const projectId = await this.getProjectId();
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [accessResponse] = await this.secretClient.accessSecretVersion({
      name,
    });
    const payload = accessResponse.payload?.data?.toString();

    if (!payload) {
      throw new Error(`No secret payload found for secret "${secretName}"`);
    }

    return payload;
  }
}
