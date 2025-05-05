-- CreateTable
CREATE TABLE "PendingConversions" (
    "id" TEXT NOT NULL,
    "source" "CryptoCurrency" NOT NULL,
    "target" "TargetCurrency" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PendingConversions_pkey" PRIMARY KEY ("id")
);
