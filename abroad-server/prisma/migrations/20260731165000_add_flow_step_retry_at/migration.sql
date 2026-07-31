ALTER TABLE "FlowStepInstance"
ADD COLUMN "retryAt" TIMESTAMP(3);

CREATE INDEX "flow_step_retry_due_idx"
ON "FlowStepInstance"("status", "stepType", "retryAt");
