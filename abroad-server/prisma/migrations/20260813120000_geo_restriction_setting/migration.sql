-- The region gate that GET /geo/country serves was a hardcoded constant, so
-- lifting or re-applying it needed a code change and a deploy. This table gives
-- Ops a durable switch for it.
--   * Exactly one row, id 'global'. The restricted country list stays in code;
--     this row only decides whether that list is applied.
--   * The row is seeded enabled so the migration preserves today's behavior.
--   * version carries optimistic concurrency for the Ops mutation envelope.

-- CreateTable
CREATE TABLE "public"."GeoRestrictionSetting" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoRestrictionSetting_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."GeoRestrictionSetting" ADD CONSTRAINT "GeoRestrictionSetting_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."OpsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the singleton row. ON CONFLICT keeps the migration idempotent and leaves
-- an operator's current choice untouched if the row somehow already exists.
INSERT INTO "public"."GeoRestrictionSetting" ("id", "enabled", "version", "updatedAt")
VALUES ('global', true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
