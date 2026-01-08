-- AlterTable
ALTER TABLE "public"."OutboxEvent" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."TransactionTransition" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "fromStatus" "public"."TransactionStatus" NOT NULL,
    "toStatus" "public"."TransactionStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionTransition_transactionId_createdAt_idx" ON "public"."TransactionTransition"("transactionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionTransition_transactionId_idempotencyKey_key" ON "public"."TransactionTransition"("transactionId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "public"."TransactionTransition" ADD CONSTRAINT "TransactionTransition_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
