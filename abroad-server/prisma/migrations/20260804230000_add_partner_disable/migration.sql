-- Partner gains disable/enable columns, mirroring PartnerUser.
--   * disabledAt == null means the partner is active.
--   * Suspending a partner blocks authentication for every one of its API keys
--     and client-domain sessions at once, so it is the blunt "freeze this
--     integration" lever; disabling a single PartnerUser stays per-user.
--   * Nullable with no default, so every existing partner stays active.

-- AlterTable
ALTER TABLE "public"."Partner" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledBy" TEXT,
ADD COLUMN     "disabledReason" TEXT;
