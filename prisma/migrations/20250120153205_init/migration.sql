-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CryptoCurrency" AS ENUM ('USDC');

-- CreateEnum
CREATE TYPE "BlockchainNetwork" AS ENUM ('STELLAR');

-- CreateEnum
CREATE TYPE "Country" AS ENUM ('CO');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('NEQUI');

-- CreateEnum
CREATE TYPE "TargetCurrency" AS ENUM ('COP');

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apiKey" TEXT NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerUser" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "targetAmount" DOUBLE PRECISION NOT NULL,
    "sourceAmount" DOUBLE PRECISION NOT NULL,
    "targetCurrency" "TargetCurrency" NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "country" "Country" NOT NULL,
    "cryptoCurrency" "CryptoCurrency" NOT NULL,
    "network" "BlockchainNetwork" NOT NULL,
    "partnerId" TEXT NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "partnerUserId" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quoteId" TEXT NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_apiKey_key" ON "Partner"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerUser_partnerId_partnerUserId_key" ON "PartnerUser"("partnerId", "partnerUserId");

-- CreateIndex
CREATE INDEX "Quote_partnerId_idx" ON "Quote"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_quoteId_key" ON "Transaction"("quoteId");

-- AddForeignKey
ALTER TABLE "PartnerUser" ADD CONSTRAINT "PartnerUser_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "PartnerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
