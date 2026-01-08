-- Create supporting extension for UUID generation if not already present
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "PartnerMonthlyLimit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partnerId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PartnerMonthlyLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_method_month_unique" ON "PartnerMonthlyLimit"("partnerId", "paymentMethod", "month");

CREATE TABLE "PartnerUserMonthlyLimit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partnerUserId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PartnerUserMonthlyLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_user_method_month_unique" ON "PartnerUserMonthlyLimit"("partnerUserId", "paymentMethod", "month");
