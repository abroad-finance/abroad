-- New flow step instances start as NOT_STARTED; the orchestrator promotes the
-- next step to READY only after its predecessor succeeds. Existing rows are not
-- backfilled (in-flight flows keep working under the run() row lock alone).
ALTER TABLE "FlowStepInstance" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';
