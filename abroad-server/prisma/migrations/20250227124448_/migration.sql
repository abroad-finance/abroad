/*
  Warnings:

  - A unique constraint covering the columns `[partnerId,userId]` on the table `PartnerUser` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "PartnerUser_partnerId_userId_key" ON "PartnerUser"("partnerId", "userId");
