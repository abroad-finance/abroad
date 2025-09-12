/*
  Warnings:

  - The values [PENDING,SUCCESS,FAILED,CANCELLED,EXPIRED] on the enum `TransactionStatus` will be removed. If these variants are still used in the database, this will fail.
  - Added the required column `kycStatus` to the `PartnerUser` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PENDING_APPROVAL');

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionStatus_new" AS ENUM ('AWAITING_PAYMENT');
ALTER TABLE "Transaction" ALTER COLUMN "status" TYPE "TransactionStatus_new" USING ("status"::text::"TransactionStatus_new");
ALTER TYPE "TransactionStatus" RENAME TO "TransactionStatus_old";
ALTER TYPE "TransactionStatus_new" RENAME TO "TransactionStatus";
DROP TYPE "TransactionStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "PartnerUser" ADD COLUMN     "kycStatus" "KycStatus" NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "onChainId" TEXT;
