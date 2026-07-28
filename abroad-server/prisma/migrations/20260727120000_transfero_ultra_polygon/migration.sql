BEGIN;

-- A submitted legacy batch is already travelling on Solana and cannot be
-- reinterpreted as Polygon. Require operations to drain it before rollout.
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
      'Transfero Ultra migration requires all non-terminal SOL bridge batches and legs to be drained';
  END IF;
END $$;

-- Flow snapshots are immutable execution contracts. Do not switch a live flow
-- to another chain under its feet; require it to finish before definitions move.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."FlowInstance" instance
    JOIN "public"."Transaction" transaction
      ON transaction."id" = instance."transactionId"
    CROSS JOIN LATERAL jsonb_array_elements(instance."flowSnapshot"->'steps') step
    WHERE instance."status" IN ('NOT_STARTED', 'IN_PROGRESS', 'WAITING')
      AND transaction."status" IN ('AWAITING_PAYMENT', 'PROCESSING_PAYMENT')
      AND transaction."createdAt" >= CURRENT_TIMESTAMP - INTERVAL '15 days'
      AND (
        (
          step->>'stepType' = 'EXCHANGE_SEND'
          AND step->'config'->>'provider' = 'transfero'
        )
        OR (
          step->>'stepType' = 'TREASURY_TRANSFER'
          AND step->'config'->>'destinationProvider' = 'transfero'
        )
        OR (
          step->>'stepType' = 'ENQUEUE_BRIDGE'
          AND step->'config'->>'destNetwork' = 'SOL'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Transfero Ultra migration requires retained legacy Transfero payouts to reach a terminal state';
  END IF;
END $$;

-- Direct hot-wallet -> legacy Transfero flows must be rebuilt Binance-first.
-- Restrict the automated rewrite to the exact three-step USDC/BRL shape; abort
-- instead of guessing if production contains a different direct definition.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."FlowDefinition"
    WHERE "userSteps" @> '[{"type":"MOVE_TO_EXCHANGE","venue":"TRANSFERO"}]'::jsonb
      AND (
        "cryptoCurrency" <> 'USDC'
        OR "targetCurrency" <> 'BRL'
        OR "payoutProvider" <> 'PIX'
        OR jsonb_array_length("userSteps") <> 3
        OR NOT "userSteps" @> '[{"type":"PAYOUT"}]'::jsonb
        OR NOT "userSteps" @> '[{"type":"CONVERT","venue":"TRANSFERO","fromAsset":"USDC","toAsset":"BRL"}]'::jsonb
      )
  ) THEN
    RAISE EXCEPTION
      'Transfero Ultra migration found an unsupported direct Transfero flow definition';
  END IF;
END $$;

-- Old provider-wait flows can remain structurally WAITING after their customer
-- transaction has reached a terminal outcome. The legacy API also retains
-- payout records for only 15 days, so older non-terminal snapshots can no
-- longer be reconciled. Retire both groups from execution before the Ultra-only
-- runtime starts, without inventing a customer-visible transaction outcome.
CREATE TEMP TABLE "_transfero_ultra_retired_legacy_instances" ON COMMIT DROP AS
SELECT DISTINCT
    instance."id",
    CASE
      WHEN transaction."status" IN (
        'PAYMENT_FAILED',
        'PAYMENT_EXPIRED',
        'PAYMENT_COMPLETED',
        'WRONG_AMOUNT'
      )
        THEN 'transaction_terminal'
      ELSE 'legacy_provider_retention_elapsed'
    END AS "retirementReason"
  FROM "public"."FlowInstance" instance
  JOIN "public"."Transaction" transaction
    ON transaction."id" = instance."transactionId"
  CROSS JOIN LATERAL jsonb_array_elements(instance."flowSnapshot"->'steps') step
  WHERE instance."status" IN ('NOT_STARTED', 'IN_PROGRESS', 'WAITING')
    AND (
      transaction."status" IN (
        'PAYMENT_FAILED',
        'PAYMENT_EXPIRED',
        'PAYMENT_COMPLETED',
        'WRONG_AMOUNT'
      )
      OR (
        transaction."status" IN ('AWAITING_PAYMENT', 'PROCESSING_PAYMENT')
        AND transaction."createdAt" < CURRENT_TIMESTAMP - INTERVAL '15 days'
      )
    )
    AND (
      (
        step->>'stepType' = 'EXCHANGE_SEND'
        AND step->'config'->>'provider' = 'transfero'
      )
      OR (
        step->>'stepType' = 'TREASURY_TRANSFER'
        AND step->'config'->>'destinationProvider' = 'transfero'
      )
      OR (
        step->>'stepType' = 'ENQUEUE_BRIDGE'
        AND step->'config'->>'destNetwork' = 'SOL'
      )
    );

UPDATE "public"."FlowStepInstance" step
SET
  "status" = 'FAILED',
  "endedAt" = COALESCE(step."endedAt", CURRENT_TIMESTAMP),
  "error" = jsonb_build_object(
    'code', 'transfero_ultra_legacy_flow_retired',
    'reason', retired."retirementReason"
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_transfero_ultra_retired_legacy_instances" retired
WHERE step."flowInstanceId" = retired."id"
  AND step."stepType" = 'AWAIT_PROVIDER_STATUS'
  AND step."status" IN ('NOT_STARTED', 'READY', 'RUNNING', 'WAITING');

UPDATE "public"."FlowInstance" instance
SET
  "status" = 'FAILED',
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_transfero_ultra_retired_legacy_instances" retired
WHERE instance."id" = retired."id";

-- Existing multi-hop definitions already use pooled Binance bridging. Point
-- only their future bridge legs at Polygon; historical snapshots remain intact.
UPDATE "public"."FlowStepDefinition" AS bridge_step
SET
  "config" = jsonb_set(bridge_step."config", '{destNetwork}', '"MATIC"'::jsonb),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE bridge_step."stepType" = 'ENQUEUE_BRIDGE'
  AND bridge_step."config"->>'destNetwork' = 'SOL'
  AND EXISTS (
    SELECT 1
    FROM "public"."FlowStepDefinition" conversion
    WHERE conversion."flowDefinitionId" = bridge_step."flowDefinitionId"
      AND conversion."stepType" = 'EXCHANGE_CONVERT'
      AND conversion."config"->>'provider' = 'transfero'
  );

-- The Ultra provider derives Polygon from vault metadata. Delete any historical
-- network override from future per-flow transfer definitions so it cannot
-- suggest that a legacy chain is still supported.
UPDATE "public"."FlowStepDefinition" AS transfer_step
SET
  "config" = transfer_step."config" - 'network',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE transfer_step."stepType" = 'TREASURY_TRANSFER'
  AND transfer_step."config"->>'destinationProvider' = 'transfero';

CREATE TEMP TABLE "_transfero_ultra_direct_flows" ON COMMIT DROP AS
SELECT
  "id",
  "payoutProvider"
FROM "public"."FlowDefinition"
WHERE "cryptoCurrency" = 'USDC'
  AND "targetCurrency" = 'BRL'
  AND "userSteps" @> '[{"type":"MOVE_TO_EXCHANGE","venue":"TRANSFERO"}]'::jsonb;

UPDATE "public"."FlowDefinition" definition
SET
  "userSteps" = jsonb_build_array(
    jsonb_build_object('type', 'PAYOUT'),
    jsonb_build_object('type', 'MOVE_TO_EXCHANGE', 'venue', 'BINANCE'),
    jsonb_build_object(
      'type', 'TRANSFER_VENUE',
      'asset', 'USDC',
      'fromVenue', 'BINANCE',
      'toVenue', 'TRANSFERO'
    ),
    jsonb_build_object(
      'type', 'CONVERT',
      'fromAsset', 'USDC',
      'toAsset', 'BRL',
      'venue', 'TRANSFERO'
    )
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_transfero_ultra_direct_flows" direct
WHERE definition."id" = direct."id";

DELETE FROM "public"."FlowStepDefinition" step
USING "_transfero_ultra_direct_flows" direct
WHERE step."flowDefinitionId" = direct."id";

INSERT INTO "public"."FlowStepDefinition" (
  "id",
  "flowDefinitionId",
  "stepOrder",
  "stepType",
  "completionPolicy",
  "config",
  "signalMatch",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  direct."id",
  generated."stepOrder",
  generated."stepType"::"public"."FlowStepType",
  generated."completionPolicy"::"public"."FlowStepCompletionPolicy",
  generated."config",
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_transfero_ultra_direct_flows" direct
CROSS JOIN LATERAL (
  VALUES
    (
      1,
      'PAYOUT_SEND',
      'SYNC',
      jsonb_build_object('paymentMethod', direct."payoutProvider"::text)
    ),
    (2, 'AWAIT_PROVIDER_STATUS', 'AWAIT_EVENT', '{}'::jsonb),
    (3, 'EXCHANGE_SEND', 'SYNC', '{"provider":"binance"}'::jsonb),
    (4, 'AWAIT_EXCHANGE_BALANCE', 'AWAIT_EVENT', '{"provider":"binance"}'::jsonb),
    (5, 'ENQUEUE_BRIDGE', 'SYNC', '{"asset":"USDC","destNetwork":"MATIC"}'::jsonb),
    (
      6,
      'EXCHANGE_CONVERT',
      'SYNC',
      '{"provider":"transfero","sourceCurrency":"USDC","targetCurrency":"BRL"}'::jsonb
    )
) AS generated("stepOrder", "stepType", "completionPolicy", "config");

COMMIT;
