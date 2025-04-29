/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `Partner` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "country" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "phone" TEXT,
ALTER COLUMN "apiKey" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Partner_email_key" ON "Partner"("email");
