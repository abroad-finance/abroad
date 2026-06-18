-- Add ENQUEUE_BRIDGE to FlowStepType. Kept in its own migration so the value is
-- committed before any later migration or runtime DML references it (Postgres
-- cannot use a new enum value in the same transaction that adds it).
ALTER TYPE "FlowStepType" ADD VALUE IF NOT EXISTS 'ENQUEUE_BRIDGE';
