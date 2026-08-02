ALTER TABLE "public"."Partner"
  ADD COLUMN "previousApiKey" TEXT,
  ADD COLUMN "previousApiKeyExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Partner_previousApiKey_key"
  ON "public"."Partner"("previousApiKey");

ALTER TABLE "public"."Partner"
  ADD CONSTRAINT "Partner_previousApiKey_expiry_check"
  CHECK (
    ("previousApiKey" IS NULL AND "previousApiKeyExpiresAt" IS NULL)
    OR ("previousApiKey" IS NOT NULL AND "previousApiKeyExpiresAt" IS NOT NULL)
  );
