ALTER TABLE "public"."OpsConfigurationRelease"
  ADD COLUMN "impact" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "appliedVersion" INTEGER;

ALTER TABLE "public"."OpsConfigurationRelease"
  ALTER COLUMN "impact" DROP DEFAULT;
