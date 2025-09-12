/*
  Warnings:

  - Added the required column `link` to the `PartnerUserKyc` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PartnerUserKyc" ADD COLUMN     "link" TEXT NOT NULL;
