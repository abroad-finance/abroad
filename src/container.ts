import {
  CachedSecretManager,
  GcpSecretManager,
  ISecretManager,
} from "./environment";
import {
  IDatabaseClientProvider,
  PrismaClientProvider,
} from "./infrastructure/db";
import { NequiPaymentService } from "./services/nequi";

// Compose the secret manager using dependency injection.
const gcpSecretManager: ISecretManager = new GcpSecretManager();
export const secretManager: ISecretManager = new CachedSecretManager(
  gcpSecretManager,
);

export const prismaClientProvider: IDatabaseClientProvider =
  new PrismaClientProvider(secretManager);

export const nequiPaymentService = new NequiPaymentService({ secretManager });
