ALTER TABLE "public"."Transaction"
ADD COLUMN "pixEndToEndId" TEXT;

CREATE UNIQUE INDEX "Transaction_pixEndToEndId_key"
ON "public"."Transaction"("pixEndToEndId");
