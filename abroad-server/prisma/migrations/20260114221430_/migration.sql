/*
  Warnings:

  - The primary key for the `PartnerDailyLimit` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `PartnerMonthlyLimit` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `PartnerUserDailyLimit` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `PartnerUserMonthlyLimit` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- CreateEnum
CREATE TYPE "public"."OrphanRefundStatus" AS ENUM ('PENDING', 'FAILED', 'SUCCEEDED');

-- AlterTable
ALTER TABLE "public"."PartnerDailyLimit" DROP CONSTRAINT "PartnerDailyLimit_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "PartnerDailyLimit_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."PartnerMonthlyLimit" DROP CONSTRAINT "PartnerMonthlyLimit_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "PartnerMonthlyLimit_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."PartnerUserDailyLimit" DROP CONSTRAINT "PartnerUserDailyLimit_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "PartnerUserDailyLimit_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."PartnerUserMonthlyLimit" DROP CONSTRAINT "PartnerUserMonthlyLimit_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "PartnerUserMonthlyLimit_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "public"."StellarOrphanRefund" (
    "paymentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "reason" TEXT,
    "refundTransactionId" TEXT,
    "status" "public"."OrphanRefundStatus" NOT NULL,

    CONSTRAINT "StellarOrphanRefund_pkey" PRIMARY KEY ("paymentId")
);

-- RenameIndex
ALTER INDEX "public"."partner_method_day_unique" RENAME TO "PartnerDailyLimit_partnerId_paymentMethod_day_key";

-- RenameIndex
ALTER INDEX "public"."partner_method_month_unique" RENAME TO "PartnerMonthlyLimit_partnerId_paymentMethod_month_key";

-- RenameIndex
ALTER INDEX "public"."partner_user_method_day_unique" RENAME TO "PartnerUserDailyLimit_partnerUserId_paymentMethod_day_key";

-- RenameIndex
ALTER INDEX "public"."partner_user_method_month_unique" RENAME TO "PartnerUserMonthlyLimit_partnerUserId_paymentMethod_month_key";
