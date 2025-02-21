// src/infrastructure/db.ts
import { PrismaClient } from "@prisma/client";
import { ISecretManager } from "../environment";

export interface IDatabaseClientProvider {
  getClient(): Promise<PrismaClient>;
}

export class PrismaClientProvider implements IDatabaseClientProvider {
  private secretManager: ISecretManager;
  private prismaClient: PrismaClient | null = null;
  private datasourceUrl: string | null = null;

  constructor(secretManager: ISecretManager) {
    this.secretManager = secretManager;
  }

  public async getClient(): Promise<PrismaClient> {
    // Return the cached client if available.
    if (this.prismaClient) {
      return this.prismaClient;
    }

    // Cache the datasourceUrl to avoid multiple calls.
    if (!this.datasourceUrl) {
      this.datasourceUrl = await this.secretManager.getSecret("DATABASE_URL");
    }

    // Instantiate and cache the PrismaClient.
    this.prismaClient = new PrismaClient({
      datasourceUrl: this.datasourceUrl,
    });

    return this.prismaClient;
  }
}
