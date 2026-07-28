BEGIN;

-- A terminal flow is an immutable execution boundary. Before the application
-- guard is deployed, close unfinished steps on retired Transfero/Solana
-- snapshots so a queued balance signal cannot advance them again.
CREATE TEMP TABLE "_terminal_legacy_transfero_flows" ON COMMIT DROP AS
SELECT instance."id", instance."transactionId"
FROM "public"."FlowInstance" instance
WHERE instance."status" IN ('FAILED', 'COMPLETED')
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(instance."flowSnapshot"->'steps') step
    WHERE step->>'stepType' = 'ENQUEUE_BRIDGE'
      AND step->'config'->>'destNetwork' = 'SOL'
  )
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(instance."flowSnapshot"->'steps') step
    WHERE step->>'stepType' = 'EXCHANGE_CONVERT'
      AND step->'config'->>'provider' = 'transfero'
  );

UPDATE "public"."FlowStepInstance" step
SET
  "status" = 'SKIPPED',
  "endedAt" = COALESCE(step."endedAt", CURRENT_TIMESTAMP),
  "error" = COALESCE(
    step."error",
    jsonb_build_object('code', 'terminal_legacy_flow_closed')
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_terminal_legacy_transfero_flows" terminal
WHERE step."flowInstanceId" = terminal."id"
  AND step."status" IN ('NOT_STARTED', 'READY', 'RUNNING', 'WAITING');

-- Never reinterpret an in-flight legacy snapshot. This is the same immutable
-- snapshot rule used by the primary Ultra migration, repeated at the repair
-- boundary before touching bridge accounting.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."FlowInstance" instance
    WHERE instance."status" IN ('NOT_STARTED', 'IN_PROGRESS', 'WAITING')
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(instance."flowSnapshot"->'steps') step
        WHERE step->>'stepType' = 'ENQUEUE_BRIDGE'
          AND step->'config'->>'destNetwork' = 'SOL'
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(instance."flowSnapshot"->'steps') step
        WHERE step->>'stepType' = 'EXCHANGE_CONVERT'
          AND step->'config'->>'provider' = 'transfero'
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate bridge legs while a legacy Transfero/Solana flow remains active';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."BridgeBatch"
    WHERE "destNetwork" = 'SOL'
      AND "status" IN ('OPEN', 'SUBMITTED')
  ) OR EXISTS (
    SELECT 1
    FROM "public"."BridgePendingTransfer"
    WHERE "destNetwork" = 'SOL'
      AND (
        "status" = 'BATCHED'
        OR (
          "status" = 'PENDING'
          AND "batchId" IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate a legacy SOL bridge obligation after it has been batched';
  END IF;
END $$;

-- These rows are accounting obligations for USDC already delivered to Binance.
-- Preserve the obligation and amount, but point the unbatched transfer at the
-- Ultra Polygon vault used by the sole supported bridge sweep.
UPDATE "public"."BridgePendingTransfer" leg
SET
  "destNetwork" = 'MATIC',
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_terminal_legacy_transfero_flows" terminal
WHERE leg."transactionId" = terminal."transactionId"
  AND leg."destNetwork" = 'SOL'
  AND leg."status" = 'PENDING'
  AND leg."batchId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "public"."FlowInstance" instance
    CROSS JOIN LATERAL jsonb_array_elements(instance."flowSnapshot"->'steps') snapshot_step
    WHERE instance."id" = terminal."id"
      AND snapshot_step->>'stepType' = 'ENQUEUE_BRIDGE'
      AND snapshot_step->'config'->>'destNetwork' = 'SOL'
      AND (snapshot_step->>'stepOrder')::int = leg."stepOrder"
  );

-- Fail the migration instead of silently leaving executable legacy state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."BridgeBatch"
    WHERE "destNetwork" = 'SOL'
      AND "status" IN ('OPEN', 'SUBMITTED')
  ) OR EXISTS (
    SELECT 1
    FROM "public"."BridgePendingTransfer"
    WHERE "destNetwork" = 'SOL'
      AND "status" IN ('PENDING', 'BATCHED')
  ) THEN
    RAISE EXCEPTION
      'Non-terminal SOL bridge state remains after terminal-flow repair';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."FlowStepInstance" step
    JOIN "_terminal_legacy_transfero_flows" terminal
      ON terminal."id" = step."flowInstanceId"
    WHERE step."status" IN ('NOT_STARTED', 'READY', 'RUNNING', 'WAITING')
  ) THEN
    RAISE EXCEPTION
      'Executable step state remains on a terminal legacy Transfero flow';
  END IF;
END $$;

COMMIT;
