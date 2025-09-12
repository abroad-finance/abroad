/*
  Warnings:

  - The primary key for the `PendingConversions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `PendingConversions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PendingConversions" DROP CONSTRAINT "PendingConversions_pkey",
DROP COLUMN "id",
ADD CONSTRAINT "PendingConversions_pkey" PRIMARY KEY ("source", "target");
