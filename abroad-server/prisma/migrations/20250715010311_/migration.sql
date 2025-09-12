/*
  Warnings:

  - You are about to drop the column `accountNumber` on the `PartnerUser` table. All the data in the column will be lost.
  - You are about to drop the column `bank` on the `PartnerUser` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMethod` on the `PartnerUser` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PartnerUser" DROP COLUMN "accountNumber",
DROP COLUMN "bank",
DROP COLUMN "paymentMethod";
