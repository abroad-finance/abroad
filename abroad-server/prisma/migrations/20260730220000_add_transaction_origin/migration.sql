-- Persist webhook-routing provenance at the transaction boundary. Existing
-- rows and writes from an older application revision remain LEGACY so their
-- SEP callback behavior is preserved during the rolling deployment. New code
-- always writes DIRECT or SEP_24 explicitly.
CREATE TYPE "public"."TransactionOrigin" AS ENUM ('DIRECT', 'SEP_24', 'LEGACY');

ALTER TABLE "public"."Transaction"
ADD COLUMN "origin" "public"."TransactionOrigin" NOT NULL DEFAULT 'LEGACY';
