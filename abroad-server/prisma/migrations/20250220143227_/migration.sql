-- CreateTable
CREATE TABLE "StellarListenerState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastPagingToken" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StellarListenerState_pkey" PRIMARY KEY ("id")
);
