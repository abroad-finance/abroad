CREATE TYPE "public"."PartnerPortalRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "public"."PartnerApiKeyScope" AS ENUM ('TRANSACTIONS_READ', 'TRANSACTIONS_WRITE', 'PARTNER_USERS_READ', 'PARTNER_USERS_WRITE', 'KYC_READ', 'KYC_WRITE', 'TELEMETRY_WRITE');
CREATE TYPE "public"."PartnerPortalPasswordResetPurpose" AS ENUM ('INVITATION', 'PASSWORD_RESET');
CREATE TYPE "public"."WebhookDeliveryPurpose" AS ENUM ('TRANSACTION', 'TEST', 'REDELIVERY');
CREATE TYPE "public"."WebhookCredentialMode" AS ENUM ('PARTNER_CURRENT', 'PARTNER_PENDING', 'LEGACY_ORIGIN');
CREATE TYPE "public"."PartnerReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS');
CREATE TYPE "public"."PartnerReconciliationItemStatus" AS ENUM ('UPDATED', 'UNCHANGED', 'INELIGIBLE', 'FAILED');

ALTER TABLE "public"."PartnerPortalUser"
  ALTER COLUMN "passwordVerifier" DROP NOT NULL,
  ADD COLUMN "role" "public"."PartnerPortalRole" NOT NULL DEFAULT 'MEMBER',
  ADD COLUMN "mfaSecretCiphertext" TEXT,
  ADD COLUMN "mfaPendingSecretCiphertext" TEXT,
  ADD COLUMN "mfaPendingCreatedAt" TIMESTAMP(3),
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
  ADD COLUMN "mfaLastUsedCounter" BIGINT,
  ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);

UPDATE "public"."PartnerPortalUser"
SET "role" = 'ADMIN';

CREATE TABLE "public"."PartnerApiKey" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "displayPrefix" TEXT NOT NULL,
  "scopes" "public"."PartnerApiKeyScope"[] NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "rotatedFromId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerWebhookConfiguration" (
  "partnerId" TEXT NOT NULL,
  "activeSecretCiphertext" TEXT,
  "activeSecretPrefix" TEXT,
  "activeSecretVersion" INTEGER NOT NULL DEFAULT 0,
  "pendingUrl" TEXT,
  "pendingSecretCiphertext" TEXT,
  "pendingSecretPrefix" TEXT,
  "pendingRevision" INTEGER NOT NULL DEFAULT 0,
  "lastTestedRevision" INTEGER,
  "lastTestedAt" TIMESTAMP(3),
  "lastTestSucceeded" BOOLEAN,
  "lastTestHttpStatus" INTEGER,
  "lastTestDurationMs" INTEGER,
  "lastTestFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerWebhookConfiguration_pkey" PRIMARY KEY ("partnerId")
);

CREATE TABLE "public"."PartnerPortalMfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerPortalMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerPortalPasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "purpose" "public"."PartnerPortalPasswordResetPurpose" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerPortalPasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerPortalAuditEvent" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerPortalAuditEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."OutboxEvent"
  ADD COLUMN "partnerId" TEXT,
  ADD COLUMN "transactionId" TEXT,
  ADD COLUMN "webhookEvent" TEXT,
  ADD COLUMN "webhookPurpose" "public"."WebhookDeliveryPurpose",
  ADD COLUMN "webhookCredentialMode" "public"."WebhookCredentialMode",
  ADD COLUMN "sourceOutboxEventId" TEXT,
  ADD COLUMN "initiatedByPortalUserId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "lastHttpStatus" INTEGER,
  ADD COLUMN "lastAttemptDurationMs" INTEGER;

CREATE TABLE "public"."PartnerReconciliationRun" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "initiatedByPortalUserId" TEXT NOT NULL,
  "status" "public"."PartnerReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "batchSize" INTEGER NOT NULL,
  "cursorCreatedAt" TIMESTAMP(3),
  "cursorTransactionId" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "ineligibleCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerReconciliationItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "status" "public"."PartnerReconciliationItemStatus" NOT NULL,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerReconciliationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerApiKey_secretHash_key" ON "public"."PartnerApiKey"("secretHash");
CREATE UNIQUE INDEX "PartnerApiKey_rotatedFromId_key" ON "public"."PartnerApiKey"("rotatedFromId");
CREATE INDEX "PartnerApiKey_partnerId_revokedAt_expiresAt_idx" ON "public"."PartnerApiKey"("partnerId", "revokedAt", "expiresAt");
CREATE UNIQUE INDEX "PartnerPortalMfaRecoveryCode_codeHash_key" ON "public"."PartnerPortalMfaRecoveryCode"("codeHash");
CREATE INDEX "PartnerPortalMfaRecoveryCode_userId_consumedAt_idx" ON "public"."PartnerPortalMfaRecoveryCode"("userId", "consumedAt");
CREATE UNIQUE INDEX "PartnerPortalPasswordResetToken_tokenHash_key" ON "public"."PartnerPortalPasswordResetToken"("tokenHash");
CREATE INDEX "PartnerPortalPasswordResetToken_userId_expiresAt_idx" ON "public"."PartnerPortalPasswordResetToken"("userId", "expiresAt");
CREATE INDEX "PartnerPortalAuditEvent_partnerId_createdAt_idx" ON "public"."PartnerPortalAuditEvent"("partnerId", "createdAt");
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "public"."OutboxEvent"("idempotencyKey");
CREATE INDEX "OutboxEvent_partnerId_transactionId_createdAt_idx" ON "public"."OutboxEvent"("partnerId", "transactionId", "createdAt");
CREATE INDEX "OutboxEvent_sourceOutboxEventId_createdAt_idx" ON "public"."OutboxEvent"("sourceOutboxEventId", "createdAt");
CREATE INDEX "PartnerReconciliationRun_partnerId_createdAt_idx" ON "public"."PartnerReconciliationRun"("partnerId", "createdAt");
CREATE UNIQUE INDEX "PartnerReconciliationItem_runId_transactionId_key" ON "public"."PartnerReconciliationItem"("runId", "transactionId");
CREATE INDEX "PartnerReconciliationItem_transactionId_idx" ON "public"."PartnerReconciliationItem"("transactionId");

ALTER TABLE "public"."PartnerApiKey" ADD CONSTRAINT "PartnerApiKey_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerApiKey" ADD CONSTRAINT "PartnerApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."PartnerPortalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerApiKey" ADD CONSTRAINT "PartnerApiKey_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "public"."PartnerApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerWebhookConfiguration" ADD CONSTRAINT "PartnerWebhookConfiguration_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerPortalMfaRecoveryCode" ADD CONSTRAINT "PartnerPortalMfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."PartnerPortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerPortalPasswordResetToken" ADD CONSTRAINT "PartnerPortalPasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."PartnerPortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerPortalPasswordResetToken" ADD CONSTRAINT "PartnerPortalPasswordResetToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."PartnerPortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerPortalAuditEvent" ADD CONSTRAINT "PartnerPortalAuditEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerPortalAuditEvent" ADD CONSTRAINT "PartnerPortalAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."PartnerPortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OutboxEvent" ADD CONSTRAINT "OutboxEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OutboxEvent" ADD CONSTRAINT "OutboxEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OutboxEvent" ADD CONSTRAINT "OutboxEvent_sourceOutboxEventId_fkey" FOREIGN KEY ("sourceOutboxEventId") REFERENCES "public"."OutboxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OutboxEvent" ADD CONSTRAINT "OutboxEvent_initiatedByPortalUserId_fkey" FOREIGN KEY ("initiatedByPortalUserId") REFERENCES "public"."PartnerPortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerReconciliationRun" ADD CONSTRAINT "PartnerReconciliationRun_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerReconciliationRun" ADD CONSTRAINT "PartnerReconciliationRun_initiatedByPortalUserId_fkey" FOREIGN KEY ("initiatedByPortalUserId") REFERENCES "public"."PartnerPortalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerReconciliationItem" ADD CONSTRAINT "PartnerReconciliationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."PartnerReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerReconciliationItem" ADD CONSTRAINT "PartnerReconciliationItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
