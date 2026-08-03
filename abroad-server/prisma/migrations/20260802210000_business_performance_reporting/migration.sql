CREATE TYPE "public"."QuoteRequestDirection" AS ENUM ('FORWARD', 'REVERSE');
CREATE TYPE "public"."QuoteRequestOutcome" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
CREATE TYPE "public"."EconomicConversionStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED', 'NOT_APPLICABLE');
CREATE TYPE "public"."EconomicFactCoverageStatus" AS ENUM ('PENDING', 'COMPLETE', 'UNAVAILABLE');
CREATE TYPE "public"."TransactionEconomicCostKind" AS ENUM ('PAYOUT_PROVIDER_FEE', 'BRIDGE_FEE', 'BLOCKCHAIN_FEE', 'REFUND_FEE');
CREATE TYPE "public"."TransactionEconomicCostStatus" AS ENUM ('PENDING', 'CONFIRMED', 'UNAVAILABLE', 'VOID');

CREATE TABLE "public"."QuoteRequestMetric" (
  "id" TEXT NOT NULL,
  "direction" "public"."QuoteRequestDirection" NOT NULL,
  "outcome" "public"."QuoteRequestOutcome" NOT NULL DEFAULT 'PENDING',
  "statusCode" INTEGER,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "QuoteRequestMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."BusinessPerformanceState" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "quoteMetricsFrom" TIMESTAMP(3),
  "lastReconciledAt" TIMESTAMP(3),
  "backfillCompletedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessPerformanceState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."TransactionEconomics" (
  "transactionId" TEXT NOT NULL,
  "sourceCurrency" "public"."CryptoCurrency" NOT NULL,
  "sourceAmountUsd" DECIMAL(36,18) NOT NULL,
  "payoutCurrency" "public"."TargetCurrency" NOT NULL,
  "customerPayoutNative" DECIMAL(36,18) NOT NULL,
  "conversionProvider" TEXT,
  "providerOperationId" TEXT,
  "conversionStatus" "public"."EconomicConversionStatus" NOT NULL DEFAULT 'PENDING',
  "proceedsCoverage" "public"."EconomicFactCoverageStatus" NOT NULL DEFAULT 'PENDING',
  "lockedRateNativePerUsd" DECIMAL(36,18),
  "providerProceedsNative" DECIMAL(36,18),
  "proceedsUnavailableReason" TEXT,
  "settledAt" TIMESTAMP(3),
  "lastReconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransactionEconomics_pkey" PRIMARY KEY ("transactionId")
);

CREATE TABLE "public"."TransactionEconomicCost" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "kind" "public"."TransactionEconomicCostKind" NOT NULL,
  "operationKey" TEXT NOT NULL,
  "status" "public"."TransactionEconomicCostStatus" NOT NULL DEFAULT 'PENDING',
  "nativeAmount" DECIMAL(36,18),
  "nativeCurrency" TEXT,
  "usdRate" DECIMAL(36,18),
  "usdAmount" DECIMAL(36,18),
  "reasonCode" TEXT,
  "observedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransactionEconomicCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuoteRequestMetric_requestedAt_outcome_idx" ON "public"."QuoteRequestMetric"("requestedAt", "outcome");
CREATE INDEX "Quote_createdAt_idx" ON "public"."Quote"("createdAt");
CREATE INDEX "transaction_createdAt_status_idx" ON "public"."Transaction"("createdAt", "status");
CREATE UNIQUE INDEX "TransactionEconomics_providerOperationId_key" ON "public"."TransactionEconomics"("providerOperationId");
CREATE INDEX "TransactionEconomics_conversionStatus_settledAt_idx" ON "public"."TransactionEconomics"("conversionStatus", "settledAt");
CREATE INDEX "TransactionEconomics_lastReconciledAt_idx" ON "public"."TransactionEconomics"("lastReconciledAt");
CREATE INDEX "TransactionEconomics_payoutCurrency_conversionStatus_idx" ON "public"."TransactionEconomics"("payoutCurrency", "conversionStatus");
CREATE UNIQUE INDEX "TransactionEconomicCost_transactionId_kind_operationKey_key" ON "public"."TransactionEconomicCost"("transactionId", "kind", "operationKey");
CREATE INDEX "TransactionEconomicCost_kind_status_observedAt_idx" ON "public"."TransactionEconomicCost"("kind", "status", "observedAt");
CREATE INDEX "TransactionEconomicCost_transactionId_status_idx" ON "public"."TransactionEconomicCost"("transactionId", "status");

ALTER TABLE "public"."TransactionEconomics"
  ADD CONSTRAINT "TransactionEconomics_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."TransactionEconomicCost"
  ADD CONSTRAINT "TransactionEconomicCost_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "public"."TransactionEconomics"("transactionId")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "public"."BusinessPerformanceState" (
  "id",
  "updatedAt"
) VALUES (
  'singleton',
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
