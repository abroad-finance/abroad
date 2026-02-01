/*
  Warnings:

  - The primary key for the `CryptoAssetConfig` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "public"."CryptoAssetConfig" DROP CONSTRAINT "CryptoAssetConfig_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "CryptoAssetConfig_pkey" PRIMARY KEY ("id");
