CREATE TABLE "public"."PartnerPortalUser" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordVerifier" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPortalUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerPortalUser_email_key"
ON "public"."PartnerPortalUser"("email");

CREATE INDEX "PartnerPortalUser_partnerId_idx"
ON "public"."PartnerPortalUser"("partnerId");

ALTER TABLE "public"."PartnerPortalUser"
ADD CONSTRAINT "PartnerPortalUser_partnerId_fkey"
FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
