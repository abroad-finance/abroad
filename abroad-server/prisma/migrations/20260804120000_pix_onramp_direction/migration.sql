-- PIX onramp: give every corridor an explicit direction and give a transaction
-- somewhere to record its on-chain destination and its inbound PIX deposit.
--
-- Every existing row is a crypto-to-fiat payout, so the new columns default to
-- CRYPTO_TO_FIAT and nothing needs backfilling beyond the default.

CREATE TYPE "public"."FlowDirection" AS ENUM ('CRYPTO_TO_FIAT', 'FIAT_TO_CRYPTO');

CREATE TYPE "public"."ReplenishLegStatus" AS ENUM ('PENDING', 'BATCHED', 'SETTLED', 'FAILED');

CREATE TYPE "public"."TreasuryReplenishStatus" AS ENUM ('OPEN', 'BOUGHT', 'WITHDRAWN', 'CREDITED', 'FAILED');

-- Safe inside the migration transaction: the new labels are not read back here.
ALTER TYPE "public"."FlowStepType" ADD VALUE IF NOT EXISTS 'CRYPTO_SEND';
ALTER TYPE "public"."FlowStepType" ADD VALUE IF NOT EXISTS 'ENQUEUE_TREASURY_REPLENISH';

ALTER TABLE "public"."Quote"
  ADD COLUMN "direction" "public"."FlowDirection" NOT NULL DEFAULT 'CRYPTO_TO_FIAT';

-- accountNumber gains a default so a FIAT_TO_CRYPTO row, which has no bank
-- destination, does not have to invent one.
ALTER TABLE "public"."Transaction"
  ALTER COLUMN "accountNumber" SET DEFAULT '',
  ADD COLUMN "destinationAddress" TEXT,
  ADD COLUMN "pixDepositId" TEXT,
  ADD COLUMN "pixPayerTaxId" TEXT;

CREATE UNIQUE INDEX "Transaction_pixDepositId_key" ON "public"."Transaction"("pixDepositId");

ALTER TABLE "public"."FlowDefinition"
  ADD COLUMN "direction" "public"."FlowDirection" NOT NULL DEFAULT 'CRYPTO_TO_FIAT';

DROP INDEX IF EXISTS "public"."FlowDefinition_cryptoCurrency_blockchain_targetCurrency_key";

CREATE UNIQUE INDEX "FlowDefinition_corridor_direction_key"
  ON "public"."FlowDefinition"("cryptoCurrency", "blockchain", "targetCurrency", "direction");

ALTER TABLE "public"."FlowCorridor"
  ADD COLUMN "direction" "public"."FlowDirection" NOT NULL DEFAULT 'CRYPTO_TO_FIAT';

DROP INDEX IF EXISTS "public"."FlowCorridor_cryptoCurrency_blockchain_targetCurrency_key";

CREATE UNIQUE INDEX "FlowCorridor_corridor_direction_key"
  ON "public"."FlowCorridor"("cryptoCurrency", "blockchain", "targetCurrency", "direction");

CREATE TABLE "public"."TreasuryReplenishRequest" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "fiatAmount" DOUBLE PRECISION NOT NULL,
    "fiatCurrency" "public"."TargetCurrency" NOT NULL,
    "asset" "public"."CryptoCurrency" NOT NULL,
    "destNetwork" "public"."BlockchainNetwork" NOT NULL,
    "status" "public"."ReplenishLegStatus" NOT NULL DEFAULT 'PENDING',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryReplenishRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."TreasuryReplenishBatch" (
    "id" TEXT NOT NULL,
    "asset" "public"."CryptoCurrency" NOT NULL,
    "destNetwork" "public"."BlockchainNetwork" NOT NULL,
    "fiatAmount" DOUBLE PRECISION NOT NULL,
    "fiatCurrency" "public"."TargetCurrency" NOT NULL,
    "boughtAmount" DOUBLE PRECISION,
    "tradeId" TEXT,
    "withdrawalId" TEXT,
    "withdrawFee" DOUBLE PRECISION,
    "status" "public"."TreasuryReplenishStatus" NOT NULL DEFAULT 'OPEN',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "TreasuryReplenishBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryReplenishRequest_transactionId_stepOrder_key"
  ON "public"."TreasuryReplenishRequest"("transactionId", "stepOrder");

CREATE INDEX "TreasuryReplenishRequest_asset_destNetwork_status_idx"
  ON "public"."TreasuryReplenishRequest"("asset", "destNetwork", "status");

CREATE INDEX "TreasuryReplenishRequest_batchId_idx"
  ON "public"."TreasuryReplenishRequest"("batchId");

CREATE UNIQUE INDEX "TreasuryReplenishBatch_tradeId_key"
  ON "public"."TreasuryReplenishBatch"("tradeId");

CREATE UNIQUE INDEX "TreasuryReplenishBatch_withdrawalId_key"
  ON "public"."TreasuryReplenishBatch"("withdrawalId");

CREATE INDEX "TreasuryReplenishBatch_asset_destNetwork_status_idx"
  ON "public"."TreasuryReplenishBatch"("asset", "destNetwork", "status");

ALTER TABLE "public"."TreasuryReplenishRequest"
  ADD CONSTRAINT "TreasuryReplenishRequest_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "public"."TreasuryReplenishBatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Rebuild the reporting view so ops can read direction, the on-chain
-- destination, and the inbound PIX deposit id.
DROP VIEW IF EXISTS "TransactionQuoteView";

CREATE VIEW "TransactionQuoteView" AS
SELECT
  t."id" AS "id",
  t."status" AS "transactionStatus",
  t."partnerUserId" AS "partnerUserId",
  t."accountNumber" AS "accountNumber",
  t."bankCode" AS "bankCode",
  t."destinationAddress" AS "destinationAddress",
  t."createdAt" AS "transactionCreatedAt",
  t."quoteId" AS "quoteId",
  t."onChainId" AS "onChainId",
  t."refundOnChainId" AS "refundOnChainId",
  t."pixDepositId" AS "pixDepositId",
  t."taxId" AS "taxId",
  t."externalId" AS "externalId",
  t."qrCode" AS "qrCode",
  q."partnerId" AS "partnerId",
  q."targetAmount" AS "targetAmount",
  q."sourceAmount" AS "sourceAmount",
  q."targetCurrency" AS "targetCurrency",
  q."paymentMethod" AS "paymentMethod",
  q."country" AS "country",
  q."cryptoCurrency" AS "cryptoCurrency",
  q."network" AS "network",
  q."direction" AS "direction",
  q."expirationDate" AS "expirationDate",
  q."createdAt" AS "quoteCreatedAt",
  q."updatedAt" AS "quoteUpdatedAt"
FROM "Transaction" AS t
JOIN "Quote" AS q ON q."id" = t."quoteId";
