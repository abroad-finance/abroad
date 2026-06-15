-- Add NOT_STARTED value to the FlowStepStatus enum.
-- Kept in its own migration so the value is committed before any later
-- migration references it (Postgres cannot use a new enum value in the same
-- transaction that adds it).
ALTER TYPE "FlowStepStatus" ADD VALUE IF NOT EXISTS 'NOT_STARTED' BEFORE 'READY';
