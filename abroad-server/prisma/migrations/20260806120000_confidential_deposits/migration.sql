-- Confidential-token deposit path (OpenZeppelin confidential tokens on Soroban).
-- Purely additive: two new tables, no change to Transaction or CryptoAssetConfig.
--
--   * ConfidentialAssetConfig pins the wrapper contract that backs a crypto asset.
--     "enabled" defaults to FALSE, so applying this migration turns nothing on;
--     the deposit path stays inert until a row is inserted and enabled.
--   * StellarConfidentialListenerState is the Soroban getEvents cursor. It is
--     separate from StellarListenerState because a confidential transfer is a
--     contract invocation rather than a Horizon payment, so the two streams page
--     independently and must not share a cursor.

-- CreateTable
CREATE TABLE "public"."ConfidentialAssetConfig" (
    "id" TEXT NOT NULL,
    "cryptoCurrency" "public"."CryptoCurrency" NOT NULL,
    "blockchain" "public"."BlockchainNetwork" NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfidentialAssetConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StellarConfidentialListenerState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastCursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StellarConfidentialListenerState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfidentialAssetConfig_cryptoCurrency_blockchain_key" ON "public"."ConfidentialAssetConfig"("cryptoCurrency", "blockchain");
