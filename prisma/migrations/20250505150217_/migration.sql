/*
  Warnings:

  - Added the required column `symbol` to the `PendingConversions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PendingConversions" ADD COLUMN     "symbol" TEXT NOT NULL;
