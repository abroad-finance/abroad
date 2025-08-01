/*
  Warnings:

  - You are about to drop the column `kycId` on the `PartnerUser` table. All the data in the column will be lost.
  - You are about to drop the column `kycStatus` on the `PartnerUser` table. All the data in the column will be lost.
  - You are about to drop the column `kycToken` on the `PartnerUser` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "KYCTier" AS ENUM ('BASIC', 'ENHANCED', 'NONE', 'STANDARD');

-- AlterTable
ALTER TABLE "PartnerUser" DROP COLUMN "kycId",
DROP COLUMN "kycStatus",
DROP COLUMN "kycToken",
ADD COLUMN     "kycExternalToken" TEXT;

-- CreateTable
CREATE TABLE "PartnerUserKyc" (
    "id" TEXT NOT NULL,
    "partnerUserId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "tier" "KYCTier" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerUserKyc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerUserKyc_partnerUserId_externalId_key" ON "PartnerUserKyc"("partnerUserId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerUserKyc_partnerUserId_tier_key" ON "PartnerUserKyc"("partnerUserId", "tier");

-- AddForeignKey
ALTER TABLE "PartnerUserKyc" ADD CONSTRAINT "PartnerUserKyc_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "PartnerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
