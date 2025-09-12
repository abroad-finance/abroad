/*
  Warnings:

  - A unique constraint covering the columns `[onChainId]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionStatus" ADD VALUE 'PROCESSING_PAYMENT';
ALTER TYPE "TransactionStatus" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "TransactionStatus" ADD VALUE 'PAYMENT_COMPLETED';

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_onChainId_key" ON "Transaction"("onChainId");
