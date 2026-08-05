-- Durable record of each attempt to deliver crypto to a FIAT_TO_CRYPTO customer.
--
-- A submission that times out leaves a signed transaction that may or may not
-- be included. Keeping the envelope and its expiry makes that resolvable: past
-- expiresAt it can never be included, so an attempt still unconfirmed then is
-- provably dead and a fresh attempt is safe. Re-submitting the stored envelope
-- is equally safe, since it carries the same hash and cannot pay twice.

CREATE TYPE "DeliveryAttemptStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'EXPIRED', 'FAILED');

CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "signedEnvelopeXdr" TEXT,
    "amount" DECIMAL(36,18) NOT NULL,
    "asset" "CryptoCurrency" NOT NULL,
    "network" "BlockchainNetwork" NOT NULL,
    "feeStroops" BIGINT,
    "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'PREPARED',
    "failureCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryAttempt_transactionHash_key" ON "DeliveryAttempt"("transactionHash");
CREATE UNIQUE INDEX "DeliveryAttempt_transactionId_attemptNumber_key" ON "DeliveryAttempt"("transactionId", "attemptNumber");
CREATE INDEX "DeliveryAttempt_status_expiresAt_idx" ON "DeliveryAttempt"("status", "expiresAt");
CREATE INDEX "DeliveryAttempt_transactionId_status_idx" ON "DeliveryAttempt"("transactionId", "status");

ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
