/*
  Warnings:

  - Added the required column `lastProcessedSlot` to the `SolanaListenerState` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "BlockchainNetwork" ADD VALUE 'SOLANA';

-- AlterTable
ALTER TABLE "SolanaListenerState" ADD COLUMN     "lastProcessedSlot" INTEGER NOT NULL;
