// src/infrastructure/db.ts
import { PrismaClient } from "@prisma/client";
import { inject } from "inversify";
import { TYPES } from "../types";
import { IDatabaseClientProvider } from "../interfaces/IDatabaseClientProvider";
import { ISecretManager } from "../interfaces/ISecretManager";

export class PrismaClientProvider implements IDatabaseClientProvider {
  private prismaClient: PrismaClient | null = null;
  private datasourceUrl: string | null = null;

  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) {}

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
