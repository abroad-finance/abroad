/*
  Warnings:

  - A unique constraint covering the columns `[externalId]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "public"."Transaction"("externalId");
