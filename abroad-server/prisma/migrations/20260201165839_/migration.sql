/*
  Warnings:

  - Added the required column `payoutProvider` to the `FlowDefinition` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userSteps` to the `FlowDefinition` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."FlowCorridorStatus" AS ENUM ('SUPPORTED', 'UNSUPPORTED');

-- AlterTable
ALTER TABLE "public"."FlowDefinition" ADD COLUMN     "payoutProvider" "public"."PaymentMethod" NOT NULL,
ADD COLUMN     "userSteps" JSONB NOT NULL;

-- CreateTable
CREATE TABLE "public"."FlowCorridor" (
    "id" TEXT NOT NULL,
    "cryptoCurrency" "public"."CryptoCurrency" NOT NULL,
    "blockchain" "public"."BlockchainNetwork" NOT NULL,
    "targetCurrency" "public"."TargetCurrency" NOT NULL,
    "status" "public"."FlowCorridorStatus" NOT NULL DEFAULT 'UNSUPPORTED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowCorridor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlowCorridor_cryptoCurrency_blockchain_targetCurrency_key" ON "public"."FlowCorridor"("cryptoCurrency", "blockchain", "targetCurrency");
