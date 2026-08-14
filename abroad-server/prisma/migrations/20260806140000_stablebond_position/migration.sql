-- Etherfuse Stablebond positions and the venue executions that move into and out
-- of them.
--
-- Two additive tables and three enums; nothing existing is touched, so this is
-- safe to apply ahead of the API/worker rollout. Both amount columns are
-- DECIMAL(36,18) rather than DOUBLE PRECISION: this is a value ledger, and the
-- older treasury tables' use of Float is not a precedent to extend.
--
-- One ledger covers both directions. Without an issuer relationship the same
-- public venue is the only route in and the only route out, so an acquisition and
-- an unwind are the same operation with the assets swapped, and they must share
-- the slippage bound, the durability and the reconciliation rules.
--
-- StablebondExecution rows are written BEFORE the venue is asked to execute,
-- which is what makes an ambiguous submission reconcilable by hash instead of
-- retryable. The unique index on "onChainId" is the structural guarantee that one
-- on-chain transaction can never be claimed by two executions.

-- The flow step that liquidates the position just in time, immediately before a
-- delivery that the liquid inventory cannot cover.
ALTER TYPE "FlowStepType" ADD VALUE IF NOT EXISTS 'STABLEBOND_UNWIND';

CREATE TYPE "StablebondPositionStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TYPE "StablebondExecutionDirection" AS ENUM ('ACQUIRE', 'UNWIND');

CREATE TYPE "StablebondExecutionStatus" AS ENUM ('QUOTED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'AMBIGUOUS');

CREATE TABLE "StablebondPosition" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "status" "StablebondPositionStatus" NOT NULL DEFAULT 'OPEN',
    "principalTokens" DECIMAL(36,18) NOT NULL,
    "principalFiat" DECIMAL(36,18) NOT NULL,
    "entryNavFiat" DECIMAL(36,18) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StablebondPosition_pkey" PRIMARY KEY ("id")
);

-- One lot per bond per venue: every execution locks the position row, and a
-- second row for the same bond would let two workers hold two different locks
-- over one balance.
CREATE UNIQUE INDEX "StablebondPosition_symbol_venue_key" ON "StablebondPosition"("symbol", "venue");
CREATE INDEX "StablebondPosition_status_symbol_idx" ON "StablebondPosition"("status", "symbol");

CREATE TABLE "StablebondExecution" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "direction" "StablebondExecutionDirection" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "StablebondExecutionStatus" NOT NULL DEFAULT 'QUOTED',
    "sendAsset" TEXT NOT NULL,
    "sendAmount" DECIMAL(36,18) NOT NULL,
    "receiveAsset" TEXT NOT NULL,
    "quotedReceive" DECIMAL(36,18) NOT NULL,
    "minReceive" DECIMAL(36,18) NOT NULL,
    "receivedAmount" DECIMAL(36,18),
    "navFiatPerToken" DECIMAL(36,18) NOT NULL,
    "navUsdPerToken" DECIMAL(36,18) NOT NULL,
    "spreadBps" INTEGER,
    "onChainId" TEXT,
    "failureReason" TEXT,
    "quotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StablebondExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StablebondExecution_idempotencyKey_key" ON "StablebondExecution"("idempotencyKey");
CREATE UNIQUE INDEX "StablebondExecution_onChainId_key" ON "StablebondExecution"("onChainId");
CREATE INDEX "StablebondExecution_positionId_quotedAt_idx" ON "StablebondExecution"("positionId", "quotedAt");
CREATE INDEX "StablebondExecution_direction_status_quotedAt_idx" ON "StablebondExecution"("direction", "status", "quotedAt");

-- RESTRICT, not CASCADE: a settled execution is a financial record and must not
-- be removable as a side effect of deleting the position it settled against.
ALTER TABLE "StablebondExecution" ADD CONSTRAINT "StablebondExecution_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "StablebondPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
