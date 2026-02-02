CREATE TABLE "public"."CryptoAssetConfig" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cryptoCurrency" "public"."CryptoCurrency" NOT NULL,
  "blockchain" "public"."BlockchainNetwork" NOT NULL,
  "mintAddress" TEXT,
  "decimals" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CryptoAssetConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CryptoAssetConfig_cryptoCurrency_blockchain_key"
  ON "public"."CryptoAssetConfig"("cryptoCurrency", "blockchain");
