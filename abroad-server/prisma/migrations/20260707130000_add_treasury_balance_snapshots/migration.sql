-- Treasury balance snapshots. The snapshot worker periodically captures one row
-- per (venue, account, currency) so the ops treasury dashboard can chart how
-- balances move over time. usdRate/usdValue freeze the indicative FX at capture
-- time so historical USD series do not drift with today's rate.

CREATE TABLE "TreasuryBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "account" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "usdRate" DOUBLE PRECISION,
    "usdValue" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryBalanceSnapshot_venue_currency_capturedAt_idx" ON "TreasuryBalanceSnapshot"("venue", "currency", "capturedAt");

CREATE INDEX "TreasuryBalanceSnapshot_capturedAt_idx" ON "TreasuryBalanceSnapshot"("capturedAt");
