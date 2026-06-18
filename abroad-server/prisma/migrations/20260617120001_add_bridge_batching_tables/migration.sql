-- Bridge-batching tables. Small CELO->BRL flows settle immediately by converting
-- against the Transfero USDC float and record the owed Binance USDC as a leg
-- here; a sweep worker batches the CELO->Solana withdrawal once the pooled
-- legs clear the per-withdrawal minimum.

CREATE TYPE "BridgeLegStatus" AS ENUM ('PENDING', 'BATCHED', 'SETTLED', 'FAILED');
CREATE TYPE "BridgeBatchStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CREDITED', 'FAILED');

CREATE TABLE "BridgeBatch" (
    "id" TEXT NOT NULL,
    "asset" "CryptoCurrency" NOT NULL,
    "destNetwork" TEXT NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "withdrawFee" DOUBLE PRECISION,
    "withdrawId" TEXT,
    "status" "BridgeBatchStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "BridgeBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BridgePendingTransfer" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "asset" "CryptoCurrency" NOT NULL,
    "destNetwork" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "BridgeLegStatus" NOT NULL DEFAULT 'PENDING',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BridgePendingTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BridgePendingTransfer_transactionId_stepOrder_key" ON "BridgePendingTransfer"("transactionId", "stepOrder");
CREATE INDEX "BridgePendingTransfer_asset_destNetwork_status_idx" ON "BridgePendingTransfer"("asset", "destNetwork", "status");
CREATE INDEX "BridgePendingTransfer_batchId_idx" ON "BridgePendingTransfer"("batchId");
CREATE INDEX "BridgeBatch_asset_destNetwork_status_idx" ON "BridgeBatch"("asset", "destNetwork", "status");

ALTER TABLE "BridgePendingTransfer" ADD CONSTRAINT "BridgePendingTransfer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BridgeBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
