-- Durable reconciliation state for operator-assisted refunds. Signed envelopes
-- are persisted before broadcast and are never exposed through the Ops API.
CREATE TYPE "RefundRecoveryStatus" AS ENUM (
  'NEEDS_RECONCILIATION',
  'ELIGIBLE',
  'AMBIGUOUS',
  'IN_FLIGHT',
  'COMPLETED',
  'BLOCKED'
);

CREATE TYPE "RefundRecoveryAttemptStatus" AS ENUM (
  'PREPARED',
  'AMBIGUOUS',
  'CONFIRMED',
  'ABSENT'
);

CREATE TYPE "RefundReconciliationResult" AS ENUM (
  'CONFIRMED',
  'ABSENT',
  'AMBIGUOUS',
  'BLOCKED'
);

CREATE TABLE "RefundRecovery" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "status" "RefundRecoveryStatus" NOT NULL DEFAULT 'NEEDS_RECONCILIATION',
  "version" INTEGER NOT NULL DEFAULT 1,
  "originalRefundHash" TEXT,
  "originalHashExpiresAt" TIMESTAMP(3),
  "lastResult" "RefundReconciliationResult",
  "lastFailureCode" TEXT,
  "lastReconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RefundRecovery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefundRecoveryAttempt" (
  "id" TEXT NOT NULL,
  "recoveryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "operationKey" TEXT NOT NULL,
  "transactionHash" TEXT NOT NULL,
  "signedEnvelopeXdr" TEXT NOT NULL,
  "amount" DECIMAL(36,18) NOT NULL,
  "asset" "CryptoCurrency" NOT NULL,
  "network" "BlockchainNetwork" NOT NULL,
  "status" "RefundRecoveryAttemptStatus" NOT NULL DEFAULT 'PREPARED',
  "failureCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "lastReconciledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "initiatedByOpsUserId" TEXT,

  CONSTRAINT "RefundRecoveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundRecovery_transactionId_key" ON "RefundRecovery"("transactionId");
CREATE UNIQUE INDEX "RefundRecovery_originalRefundHash_key" ON "RefundRecovery"("originalRefundHash");
CREATE INDEX "RefundRecovery_status_updatedAt_idx" ON "RefundRecovery"("status", "updatedAt");

CREATE UNIQUE INDEX "RefundRecoveryAttempt_operationKey_key" ON "RefundRecoveryAttempt"("operationKey");
CREATE UNIQUE INDEX "RefundRecoveryAttempt_transactionHash_key" ON "RefundRecoveryAttempt"("transactionHash");
CREATE UNIQUE INDEX "RefundRecoveryAttempt_recoveryId_attemptNumber_key" ON "RefundRecoveryAttempt"("recoveryId", "attemptNumber");
CREATE INDEX "RefundRecoveryAttempt_recoveryId_status_preparedAt_idx" ON "RefundRecoveryAttempt"("recoveryId", "status", "preparedAt");
CREATE INDEX "RefundRecoveryAttempt_initiatedByOpsUserId_preparedAt_idx" ON "RefundRecoveryAttempt"("initiatedByOpsUserId", "preparedAt");

ALTER TABLE "RefundRecovery"
  ADD CONSTRAINT "RefundRecovery_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefundRecoveryAttempt"
  ADD CONSTRAINT "RefundRecoveryAttempt_recoveryId_fkey"
  FOREIGN KEY ("recoveryId") REFERENCES "RefundRecovery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefundRecoveryAttempt"
  ADD CONSTRAINT "RefundRecoveryAttempt_initiatedByOpsUserId_fkey"
  FOREIGN KEY ("initiatedByOpsUserId") REFERENCES "OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
