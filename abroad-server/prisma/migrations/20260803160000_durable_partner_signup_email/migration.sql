CREATE TYPE "public"."PartnerPortalEmailDeliveryStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'DELAYED',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
  'SUPPRESSED',
  'UNAVAILABLE'
);

ALTER TABLE "public"."PartnerPortalEmailVerificationToken"
  ADD COLUMN "tokenCiphertext" TEXT,
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "deliveryStatus" "public"."PartnerPortalEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "deliveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastDeliveryAttemptAt" TIMESTAMP(3),
  ADD COLUMN "deliveryFailureCode" TEXT,
  ADD COLUMN "deliveryStatusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "public"."PartnerPortalEmailVerificationToken"
SET
  "deliveryStatus" = CASE
    WHEN "providerMessageId" IS NOT NULL THEN 'ACCEPTED'::"public"."PartnerPortalEmailDeliveryStatus"
    ELSE 'UNAVAILABLE'::"public"."PartnerPortalEmailDeliveryStatus"
  END,
  "deliveryStatusUpdatedAt" = COALESCE("sentAt", "createdAt");

CREATE UNIQUE INDEX "PartnerPortalEmailVerificationToken_providerMessageId_key"
  ON "public"."PartnerPortalEmailVerificationToken"("providerMessageId");
CREATE INDEX "PartnerPortalEmailVerificationToken_deliveryStatus_createdAt_idx"
  ON "public"."PartnerPortalEmailVerificationToken"("deliveryStatus", "createdAt");

CREATE TABLE "public"."PartnerPortalEmailWebhookEvent" (
  "id" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerPortalEmailWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerPortalEmailWebhookEvent_providerMessageId_occurredAt_idx"
  ON "public"."PartnerPortalEmailWebhookEvent"("providerMessageId", "occurredAt");
CREATE INDEX "PartnerPortalEmailWebhookEvent_processedAt_receivedAt_idx"
  ON "public"."PartnerPortalEmailWebhookEvent"("processedAt", "receivedAt");
