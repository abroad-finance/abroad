/*
  Warnings:

  - Added the required column `side` to the `PendingConversions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PendingConversions" ADD COLUMN     "side" TEXT NOT NULL;
