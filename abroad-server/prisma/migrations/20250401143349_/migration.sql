-- CreateTable
CREATE TABLE "SolanaListenerState" (
    "id" TEXT NOT NULL,
    "lastSignature" TEXT,
    "lastProcessedTime" TIMESTAMP(3),

    CONSTRAINT "SolanaListenerState_pkey" PRIMARY KEY ("id")
);
