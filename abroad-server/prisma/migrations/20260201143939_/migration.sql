-- CreateEnum
CREATE TYPE "public"."FlowPricingProvider" AS ENUM ('BINANCE', 'TRANSFERO');

-- CreateEnum
CREATE TYPE "public"."FlowStepType" AS ENUM ('PAYOUT_SEND', 'EXCHANGE_SEND', 'EXCHANGE_CONVERT', 'TREASURY_TRANSFER', 'AWAIT_PROVIDER_STATUS', 'AWAIT_EXCHANGE_BALANCE');

-- CreateEnum
CREATE TYPE "public"."FlowStepCompletionPolicy" AS ENUM ('SYNC', 'AWAIT_EVENT');

-- CreateEnum
CREATE TYPE "public"."FlowInstanceStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."FlowStepStatus" AS ENUM ('READY', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "public"."FlowDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cryptoCurrency" "public"."CryptoCurrency" NOT NULL,
    "blockchain" "public"."BlockchainNetwork" NOT NULL,
    "targetCurrency" "public"."TargetCurrency" NOT NULL,
    "pricingProvider" "public"."FlowPricingProvider" NOT NULL,
    "exchangeFeePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fixedFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minAmount" DOUBLE PRECISION,
    "maxAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowStepDefinition" (
    "id" TEXT NOT NULL,
    "flowDefinitionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepType" "public"."FlowStepType" NOT NULL,
    "completionPolicy" "public"."FlowStepCompletionPolicy" NOT NULL,
    "config" JSONB NOT NULL,
    "signalMatch" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowStepDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowInstance" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" "public"."FlowInstanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentStepOrder" INTEGER,
    "flowSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowStepInstance" (
    "id" TEXT NOT NULL,
    "flowInstanceId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepType" "public"."FlowStepType" NOT NULL,
    "status" "public"."FlowStepStatus" NOT NULL DEFAULT 'READY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "correlation" JSONB,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowStepInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FlowSignal" (
    "id" TEXT NOT NULL,
    "flowInstanceId" TEXT,
    "stepInstanceId" TEXT,
    "eventType" TEXT NOT NULL,
    "correlationKeys" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "FlowSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlowDefinition_cryptoCurrency_blockchain_targetCurrency_key" ON "public"."FlowDefinition"("cryptoCurrency", "blockchain", "targetCurrency");

-- CreateIndex
CREATE INDEX "FlowStepDefinition_flowDefinitionId_idx" ON "public"."FlowStepDefinition"("flowDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowStepDefinition_flowDefinitionId_stepOrder_key" ON "public"."FlowStepDefinition"("flowDefinitionId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FlowInstance_transactionId_key" ON "public"."FlowInstance"("transactionId");

-- CreateIndex
CREATE INDEX "FlowStepInstance_flowInstanceId_idx" ON "public"."FlowStepInstance"("flowInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowStepInstance_flowInstanceId_stepOrder_key" ON "public"."FlowStepInstance"("flowInstanceId", "stepOrder");

-- CreateIndex
CREATE INDEX "FlowSignal_eventType_idx" ON "public"."FlowSignal"("eventType");

-- CreateIndex
CREATE INDEX "FlowSignal_consumedAt_idx" ON "public"."FlowSignal"("consumedAt");

-- AddForeignKey
ALTER TABLE "public"."FlowStepDefinition" ADD CONSTRAINT "FlowStepDefinition_flowDefinitionId_fkey" FOREIGN KEY ("flowDefinitionId") REFERENCES "public"."FlowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FlowStepInstance" ADD CONSTRAINT "FlowStepInstance_flowInstanceId_fkey" FOREIGN KEY ("flowInstanceId") REFERENCES "public"."FlowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
