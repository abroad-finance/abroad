-- Outbox support and transaction exchange handoff timestamp

-- Exchange handoff tracking
ALTER TABLE "Transaction"
ADD COLUMN IF NOT EXISTS "exchangeHandoffAt" TIMESTAMP(3);

-- Helpful index for per-user/day limit checks and queries
CREATE INDEX IF NOT EXISTS "transaction_partnerUser_status_createdAt_idx"
  ON "Transaction"("partnerUserId", "status", "createdAt");

-- Outbox enum and table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutboxStatus') THEN
    CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DELIVERING', 'DELIVERED', 'FAILED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "OutboxEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OutboxEvent_status_availableAt_idx"
  ON "OutboxEvent"("status", "availableAt");
