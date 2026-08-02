ALTER TABLE "public"."Partner"
  ADD COLUMN "publicSignupIdempotencyHash" TEXT,
  ADD COLUMN "publicSignupOrganizationHash" TEXT;

ALTER TABLE "public"."PartnerPortalUser"
  ADD COLUMN "emailVerificationRequiredAt" TIMESTAMP(3),
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "public"."PartnerPortalEmailVerificationToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerPortalEmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerPortalPublicRateLimit" (
  "keyHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "windowEndsAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerPortalPublicRateLimit_pkey" PRIMARY KEY ("keyHash")
);

CREATE UNIQUE INDEX "Partner_publicSignupIdempotencyHash_key" ON "public"."Partner"("publicSignupIdempotencyHash");
CREATE UNIQUE INDEX "Partner_publicSignupOrganizationHash_key" ON "public"."Partner"("publicSignupOrganizationHash");
CREATE UNIQUE INDEX "Partner_email_normalized_key" ON "public"."Partner"(LOWER("email")) WHERE "email" IS NOT NULL;
CREATE UNIQUE INDEX "PartnerPortalUser_email_normalized_key" ON "public"."PartnerPortalUser"(LOWER("email"));
CREATE UNIQUE INDEX "PartnerPortalEmailVerificationToken_tokenHash_key" ON "public"."PartnerPortalEmailVerificationToken"("tokenHash");
CREATE INDEX "PartnerPortalEmailVerificationToken_userId_createdAt_idx" ON "public"."PartnerPortalEmailVerificationToken"("userId", "createdAt");
CREATE INDEX "PartnerPortalEmailVerificationToken_expiresAt_consumedAt_idx" ON "public"."PartnerPortalEmailVerificationToken"("expiresAt", "consumedAt");
CREATE INDEX "PartnerPortalPublicRateLimit_windowEndsAt_idx" ON "public"."PartnerPortalPublicRateLimit"("windowEndsAt");

ALTER TABLE "public"."PartnerPortalEmailVerificationToken"
  ADD CONSTRAINT "PartnerPortalEmailVerificationToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."PartnerPortalUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
