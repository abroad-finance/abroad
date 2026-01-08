-- Create supporting extension for UUID generation if not already present
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "PartnerDailyLimit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partnerId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PartnerDailyLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_method_day_unique" ON "PartnerDailyLimit"("partnerId", "paymentMethod", "day");

CREATE TABLE "PartnerUserDailyLimit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partnerUserId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PartnerUserDailyLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_user_method_day_unique" ON "PartnerUserDailyLimit"("partnerUserId", "paymentMethod", "day");
