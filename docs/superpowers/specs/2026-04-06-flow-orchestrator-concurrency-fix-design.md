# FlowOrchestrator Concurrency Fix

## Problem

The `FlowOrchestrator.run()` method can be called concurrently on the same flow instance from multiple entry points:

- `startFlow()` — duplicate queue messages trigger "resuming" path
- `handleSignal()` — signals call `run()` after step completion

When two `run()` calls overlap, `claimNextStep()` can claim different steps simultaneously because all steps are created with `READY` status. This allows step N+1 to execute while step N is still running.

### Production Incident (2026-03-31)

Transaction `9054225d-538e-471f-bb07-4085f6d30789`:

1. PAYOUT_SEND (step 1) and EXCHANGE_SEND (step 2) ran in parallel
2. PAYOUT_SEND failed — BREB rejected with `AM04` (insufficient Movii balance)
3. EXCHANGE_SEND succeeded — 96.74 USDC sent to Binance, converted to USDT, then to COP
4. Automatic refund also failed — Stellar hot wallet underfunded (`op_underfunded`)
5. Result: user received nothing, 350,000 COP stuck on Binance, no refund issued

## Solution

Two layers of protection applied to `FlowOrchestrator`:

### Layer 1: Pessimistic Lock with Skip

Wrap `run()` in a database transaction that acquires an exclusive row lock on the `FlowInstance` using `SELECT ... FOR UPDATE SKIP LOCKED`.

- If the lock is available: proceed with the claim-and-execute loop inside the transaction
- If the lock is already held: return immediately (no-op)

This serializes all concurrent `run()` calls for the same flow instance. The first caller drives the flow; concurrent callers exit instantly without blocking.

`SKIP LOCKED` is chosen over `NOWAIT` because it returns an empty result set (easy to check) rather than throwing an error.

### Layer 2: `NOT_STARTED` Step Status

Add `NOT_STARTED` to the `FlowStepStatus` Prisma enum. Change step lifecycle:

- When creating a flow instance: step 1 is `READY`, all subsequent steps are `NOT_STARTED`
- When a step succeeds: the orchestrator promotes the next step from `NOT_STARTED` to `READY`
- `claimNextStep()` continues to query for `READY` steps only — it naturally skips `NOT_STARTED` steps

This makes the state machine semantically correct (a step isn't "ready" until its prerequisites complete) and provides defense-in-depth independent of the lock.

### Step Status Lifecycle

```
NOT_STARTED → READY → RUNNING → SUCCEEDED
                              → FAILED
                              → WAITING → (signal) → SUCCEEDED / FAILED
```

## Changes

### 1. Prisma Schema

Add `NOT_STARTED` to `FlowStepStatus` enum. Change default from `READY` to `NOT_STARTED`:

```prisma
enum FlowStepStatus {
  NOT_STARTED
  READY
  RUNNING
  WAITING
  SUCCEEDED
  FAILED
  SKIPPED
}
```

```prisma
model FlowStepInstance {
  ...
  status FlowStepStatus @default(NOT_STARTED)
  ...
}
```

Migration is additive (new enum value + default change). No data migration for existing rows.

### 2. `FlowOrchestrator.run()`

Wrap the entire method body in a Prisma `$transaction` that first acquires the row lock:

```typescript
async run(flowInstanceId: string): Promise<void> {
  const prisma = await this.dbProvider.getClient()

  await prisma.$transaction(async (tx) => {
    // Acquire exclusive lock, skip if already held
    const locked = await tx.$queryRaw`
      SELECT id FROM "FlowInstance"
      WHERE id = ${flowInstanceId}
      FOR UPDATE SKIP LOCKED
    `
    if ((locked as any[]).length === 0) return

    // ... existing claim-and-execute loop, using `tx` instead of `prisma` ...
  })
}
```

All database operations inside `run()` — status updates, step claims, outcome persistence via `persistStepOutcome`, and `buildRuntimeContext` reads — use the transaction client `tx` instead of acquiring a new `prisma` client. This means these private methods need to accept a transaction client parameter.

### 3. `FlowOrchestrator.startFlow()`

Change step creation to set explicit statuses:

```typescript
steps: {
  create: snapshot.steps.map((step, index) => ({
    status: index === 0 ? FlowStepStatus.READY : FlowStepStatus.NOT_STARTED,
    stepOrder: step.stepOrder,
    stepType: step.stepType,
  })),
}
```

### 4. Step Promotion After Success

After a step succeeds inside the `run()` loop, promote the next step before claiming it:

```typescript
const nextOrder = this.resolveNextOrder(snapshot.steps, current.stepOrder)
if (nextOrder !== null) {
  await tx.flowStepInstance.updateMany({
    data: { status: FlowStepStatus.READY },
    where: {
      flowInstanceId,
      status: FlowStepStatus.NOT_STARTED,
      stepOrder: nextOrder,
    },
  })
}
await tx.flowInstance.update({
  data: { currentStepOrder: nextOrder },
  where: { id: flowInstanceId },
})
claimed = await this.claimNextStep(tx, flowInstanceId)
```

### 5. Tests

- Verify steps are created with correct initial statuses (first = READY, rest = NOT_STARTED)
- Verify step promotion happens on success
- Verify concurrent `run()` calls: second caller returns without executing
- Verify failed step does not promote the next step

## What Doesn't Change

- `handleSignal()` — already calls `run()`, which will acquire the lock
- `claimNextStep()` — logic unchanged, still queries for `READY` status
- Step executors, executor registry, flow definitions
- Existing data — no backfill migration

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Long-running steps hold the lock | Acceptable — steps should complete in seconds. If a step hangs, the lock prevents additional damage rather than causing it. |
| `$transaction` timeout | Prisma default is 5s for interactive transactions. Increase to 120s to accommodate polling steps like `pollTransactionReport`. |
| Existing flows with all steps READY | The lock alone prevents races. These flows will work correctly — `claimNextStep` still processes in order within a single `run()` call. |
