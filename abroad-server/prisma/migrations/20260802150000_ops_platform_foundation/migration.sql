CREATE TYPE "public"."OpsRole" AS ENUM ('VIEWER', 'SUPPORT', 'OPERATIONS', 'FINANCE', 'COMPLIANCE', 'ADMINISTRATOR');
CREATE TYPE "public"."OpsActorKind" AS ENUM ('USER', 'LEGACY_KEY', 'SYSTEM');
CREATE TYPE "public"."OpsSavedViewScope" AS ENUM ('PRIVATE', 'TEAM');
CREATE TYPE "public"."OpsSavedViewResource" AS ENUM ('INCIDENTS', 'TRANSACTIONS', 'FLOWS', 'PARTNERS', 'KYC', 'AUDIT', 'CONFIGURATION');
CREATE TYPE "public"."OpsWorkStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "public"."OpsPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "public"."OpsNoteKind" AS ENUM ('NOTE', 'ESCALATION', 'RESOLUTION');
CREATE TYPE "public"."OpsIncidentSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
CREATE TYPE "public"."OpsWorkResourceType" AS ENUM ('CASE', 'INCIDENT');
CREATE TYPE "public"."OpsConfigurationTargetType" AS ENUM ('FLOW_DEFINITION', 'FLOW_CORRIDOR', 'CRYPTO_ASSET');
CREATE TYPE "public"."OpsConfigurationReleaseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'APPLIED', 'REJECTED', 'SUPERSEDED', 'ROLLED_BACK');
CREATE TYPE "public"."OpsIntegrationKind" AS ENUM ('RUNBOOK', 'NOTIFICATION', 'WEBHOOK', 'PROVIDER');
CREATE TYPE "public"."OpsIntegrationStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'DISABLED');
CREATE TYPE "public"."OpsTaskResult" AS ENUM ('SUCCEEDED', 'FAILED', 'ABANDONED');
CREATE TYPE "public"."OpsMutationStatus" AS ENUM ('REQUESTED', 'SUCCEEDED', 'FAILED');

ALTER TABLE "public"."FlowDefinition" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "public"."FlowCorridor" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "public"."CryptoAssetConfig" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "public"."TreasuryBalanceSnapshot"
  ADD COLUMN "availableAmount" DOUBLE PRECISION,
  ADD COLUMN "blockedAmount" DOUBLE PRECISION,
  ADD COLUMN "reservedAmount" DOUBLE PRECISION,
  ADD COLUMN "outstandingAmount" DOUBLE PRECISION;

CREATE TABLE "public"."OpsUser" (
  "id" TEXT NOT NULL,
  "firebaseUid" TEXT,
  "email" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "role" "public"."OpsRole" NOT NULL DEFAULT 'VIEWER',
  "version" INTEGER NOT NULL DEFAULT 1,
  "sessionVersion" INTEGER NOT NULL DEFAULT 1,
  "sessionsRevokedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsUser_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."PartnerUserKyc"
  ADD COLUMN "opsReviewerUserId" TEXT,
  ADD COLUMN "opsReviewVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "public"."OpsAuditEvent" (
  "id" TEXT NOT NULL,
  "actorKind" "public"."OpsActorKind" NOT NULL,
  "actorUserId" TEXT,
  "actorLabel" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "reason" TEXT,
  "reference" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsSavedView" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "resource" "public"."OpsSavedViewResource" NOT NULL,
  "scope" "public"."OpsSavedViewScope" NOT NULL DEFAULT 'PRIVATE',
  "filters" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsSavedView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsCase" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "status" "public"."OpsWorkStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "public"."OpsPriority" NOT NULL DEFAULT 'NORMAL',
  "ownerUserId" TEXT,
  "team" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsCaseNote" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "kind" "public"."OpsNoteKind" NOT NULL DEFAULT 'NOTE',
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsCaseNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsRunbook" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "incidentKinds" TEXT[] NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsRunbook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsIncident" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "context" JSONB,
  "severity" "public"."OpsIncidentSeverity" NOT NULL,
  "status" "public"."OpsWorkStatus" NOT NULL DEFAULT 'OPEN',
  "ownerUserId" TEXT,
  "team" TEXT,
  "runbookId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "affectedCount" INTEGER NOT NULL DEFAULT 0,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsIncident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsIncidentNote" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "kind" "public"."OpsNoteKind" NOT NULL DEFAULT 'NOTE',
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsIncidentNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsHandoff" (
  "id" TEXT NOT NULL,
  "resourceType" "public"."OpsWorkResourceType" NOT NULL,
  "caseId" TEXT,
  "incidentId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "fromUserId" TEXT,
  "toUserId" TEXT,
  "fromTeam" TEXT,
  "toTeam" TEXT,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsHandoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpsHandoff_exactly_one_resource_check" CHECK (
    (("caseId" IS NOT NULL)::integer + ("incidentId" IS NOT NULL)::integer) = 1
  )
);

CREATE TABLE "public"."OpsIntegration" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "public"."OpsIntegrationKind" NOT NULL,
  "status" "public"."OpsIntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT NOT NULL,
  "configuration" JSONB NOT NULL,
  "lastCheckedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsTreasuryThreshold" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "minimumAvailable" DOUBLE PRECISION,
  "warningRunwayHours" DOUBLE PRECISION,
  "criticalRunwayHours" DOUBLE PRECISION,
  "ownerTeam" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsTreasuryThreshold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsConfigurationRelease" (
  "id" TEXT NOT NULL,
  "targetType" "public"."OpsConfigurationTargetType" NOT NULL,
  "targetKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "baseVersion" INTEGER NOT NULL,
  "status" "public"."OpsConfigurationReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "payload" JSONB NOT NULL,
  "diff" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "reference" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "appliedByUserId" TEXT,
  "rollbackOfId" TEXT,
  "rejectionReason" TEXT,
  "effectiveAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsConfigurationRelease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsTaskEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "task" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "result" "public"."OpsTaskResult" NOT NULL,
  "durationMs" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsTaskEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OpsMutationExecution" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" "public"."OpsMutationStatus" NOT NULL DEFAULT 'REQUESTED',
  "actorUserId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "reason" TEXT NOT NULL,
  "reference" TEXT,
  "confirmation" TEXT NOT NULL,
  "expectedVersion" INTEGER,
  "failureCode" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OpsMutationExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpsUser_firebaseUid_key" ON "public"."OpsUser"("firebaseUid");
CREATE UNIQUE INDEX "OpsUser_email_key" ON "public"."OpsUser"("email");
CREATE INDEX "OpsUser_role_disabledAt_idx" ON "public"."OpsUser"("role", "disabledAt");
CREATE INDEX "PartnerUserKyc_opsReviewerUserId_status_createdAt_idx" ON "public"."PartnerUserKyc"("opsReviewerUserId", "status", "createdAt");
CREATE INDEX "OpsAuditEvent_actorUserId_createdAt_idx" ON "public"."OpsAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "OpsAuditEvent_action_createdAt_idx" ON "public"."OpsAuditEvent"("action", "createdAt");
CREATE INDEX "OpsAuditEvent_resourceType_resourceId_createdAt_idx" ON "public"."OpsAuditEvent"("resourceType", "resourceId", "createdAt");
CREATE UNIQUE INDEX "OpsSavedView_ownerUserId_resource_name_key" ON "public"."OpsSavedView"("ownerUserId", "resource", "name");
CREATE INDEX "OpsSavedView_resource_scope_updatedAt_idx" ON "public"."OpsSavedView"("resource", "scope", "updatedAt");
CREATE UNIQUE INDEX "OpsCase_transactionId_key" ON "public"."OpsCase"("transactionId");
CREATE INDEX "OpsCase_status_priority_updatedAt_idx" ON "public"."OpsCase"("status", "priority", "updatedAt");
CREATE INDEX "OpsCase_ownerUserId_status_updatedAt_idx" ON "public"."OpsCase"("ownerUserId", "status", "updatedAt");
CREATE INDEX "OpsCaseNote_caseId_createdAt_idx" ON "public"."OpsCaseNote"("caseId", "createdAt");
CREATE UNIQUE INDEX "OpsRunbook_slug_key" ON "public"."OpsRunbook"("slug");
CREATE INDEX "OpsRunbook_active_name_idx" ON "public"."OpsRunbook"("active", "name");
CREATE UNIQUE INDEX "OpsIncident_fingerprint_key" ON "public"."OpsIncident"("fingerprint");
CREATE INDEX "OpsIncident_status_severity_lastSeenAt_idx" ON "public"."OpsIncident"("status", "severity", "lastSeenAt");
CREATE INDEX "OpsIncident_ownerUserId_status_lastSeenAt_idx" ON "public"."OpsIncident"("ownerUserId", "status", "lastSeenAt");
CREATE INDEX "OpsIncident_kind_status_lastSeenAt_idx" ON "public"."OpsIncident"("kind", "status", "lastSeenAt");
CREATE INDEX "OpsIncidentNote_incidentId_createdAt_idx" ON "public"."OpsIncidentNote"("incidentId", "createdAt");
CREATE INDEX "OpsHandoff_caseId_createdAt_idx" ON "public"."OpsHandoff"("caseId", "createdAt");
CREATE INDEX "OpsHandoff_incidentId_createdAt_idx" ON "public"."OpsHandoff"("incidentId", "createdAt");
CREATE INDEX "OpsHandoff_toUserId_createdAt_idx" ON "public"."OpsHandoff"("toUserId", "createdAt");
CREATE UNIQUE INDEX "OpsIntegration_name_key" ON "public"."OpsIntegration"("name");
CREATE INDEX "OpsIntegration_kind_status_name_idx" ON "public"."OpsIntegration"("kind", "status", "name");
CREATE UNIQUE INDEX "OpsTreasuryThreshold_venue_currency_key" ON "public"."OpsTreasuryThreshold"("venue", "currency");
CREATE INDEX "OpsTreasuryThreshold_ownerTeam_venue_currency_idx" ON "public"."OpsTreasuryThreshold"("ownerTeam", "venue", "currency");
CREATE UNIQUE INDEX "OpsConfigurationRelease_idempotencyKey_key" ON "public"."OpsConfigurationRelease"("idempotencyKey");
CREATE INDEX "OpsConfigurationRelease_targetType_targetKey_createdAt_idx" ON "public"."OpsConfigurationRelease"("targetType", "targetKey", "createdAt");
CREATE INDEX "OpsConfigurationRelease_status_effectiveAt_createdAt_idx" ON "public"."OpsConfigurationRelease"("status", "effectiveAt", "createdAt");
CREATE INDEX "OpsTaskEvent_task_action_createdAt_idx" ON "public"."OpsTaskEvent"("task", "action", "createdAt");
CREATE INDEX "OpsTaskEvent_actorUserId_createdAt_idx" ON "public"."OpsTaskEvent"("actorUserId", "createdAt");
CREATE UNIQUE INDEX "OpsMutationExecution_idempotencyKey_key" ON "public"."OpsMutationExecution"("idempotencyKey");
CREATE INDEX "OpsMutationExecution_actorUserId_requestedAt_idx" ON "public"."OpsMutationExecution"("actorUserId", "requestedAt");
CREATE INDEX "OpsMutationExecution_action_status_requestedAt_idx" ON "public"."OpsMutationExecution"("action", "status", "requestedAt");
CREATE INDEX "OpsMutationExecution_resourceType_resourceId_requestedAt_idx" ON "public"."OpsMutationExecution"("resourceType", "resourceId", "requestedAt");

ALTER TABLE "public"."OpsAuditEvent" ADD CONSTRAINT "OpsAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."PartnerUserKyc" ADD CONSTRAINT "PartnerUserKyc_opsReviewerUserId_fkey" FOREIGN KEY ("opsReviewerUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsSavedView" ADD CONSTRAINT "OpsSavedView_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "public"."OpsUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OpsCase" ADD CONSTRAINT "OpsCase_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OpsCase" ADD CONSTRAINT "OpsCase_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsCaseNote" ADD CONSTRAINT "OpsCaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."OpsCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OpsCaseNote" ADD CONSTRAINT "OpsCaseNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsRunbook" ADD CONSTRAINT "OpsRunbook_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsRunbook" ADD CONSTRAINT "OpsRunbook_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsIncident" ADD CONSTRAINT "OpsIncident_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsIncident" ADD CONSTRAINT "OpsIncident_runbookId_fkey" FOREIGN KEY ("runbookId") REFERENCES "public"."OpsRunbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsIncidentNote" ADD CONSTRAINT "OpsIncidentNote_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "public"."OpsIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OpsIncidentNote" ADD CONSTRAINT "OpsIncidentNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsHandoff" ADD CONSTRAINT "OpsHandoff_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."OpsCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OpsHandoff" ADD CONSTRAINT "OpsHandoff_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "public"."OpsIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OpsHandoff" ADD CONSTRAINT "OpsHandoff_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsHandoff" ADD CONSTRAINT "OpsHandoff_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsHandoff" ADD CONSTRAINT "OpsHandoff_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsIntegration" ADD CONSTRAINT "OpsIntegration_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsIntegration" ADD CONSTRAINT "OpsIntegration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsTreasuryThreshold" ADD CONSTRAINT "OpsTreasuryThreshold_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsTreasuryThreshold" ADD CONSTRAINT "OpsTreasuryThreshold_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsConfigurationRelease" ADD CONSTRAINT "OpsConfigurationRelease_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."OpsConfigurationRelease" ADD CONSTRAINT "OpsConfigurationRelease_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsConfigurationRelease" ADD CONSTRAINT "OpsConfigurationRelease_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsConfigurationRelease" ADD CONSTRAINT "OpsConfigurationRelease_rollbackOfId_fkey" FOREIGN KEY ("rollbackOfId") REFERENCES "public"."OpsConfigurationRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsTaskEvent" ADD CONSTRAINT "OpsTaskEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."OpsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OpsMutationExecution" ADD CONSTRAINT "OpsMutationExecution_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "public"."reject_ops_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OpsAuditEvent is append-only';
END;
$$;

CREATE TRIGGER "OpsAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "public"."OpsAuditEvent"
FOR EACH ROW
EXECUTE FUNCTION "public"."reject_ops_audit_event_mutation"();
