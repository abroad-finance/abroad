/*
  Warnings:

  - The primary key for the `PendingConversions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `source` on the `PendingConversions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `target` on the `PendingConversions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `side` on the `PendingConversions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "SupportedCurrency" AS ENUM ('USDC', 'USDT', 'COP');

-- AlterTable
ALTER TABLE "PendingConversions" DROP CONSTRAINT "PendingConversions_pkey",
DROP COLUMN "source",
ADD COLUMN     "source" "SupportedCurrency" NOT NULL,
DROP COLUMN "target",
ADD COLUMN     "target" "SupportedCurrency" NOT NULL,
DROP COLUMN "side",
ADD COLUMN     "side" "OrderSide" NOT NULL,
ADD CONSTRAINT "PendingConversions_pkey" PRIMARY KEY ("source", "target");
