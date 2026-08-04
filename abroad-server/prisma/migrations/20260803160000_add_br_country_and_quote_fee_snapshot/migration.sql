ALTER TYPE "public"."Country" ADD VALUE IF NOT EXISTS 'BR';

CREATE TYPE "public"."CustomerFeeType" AS ENUM ('COMBINED', 'FIXED', 'NONE', 'PERCENTAGE');

ALTER TABLE "public"."Quote"
  ADD COLUMN "baseRateSourcePerTarget" DECIMAL(36,18),
  ADD COLUMN "exchangeFeePct" DECIMAL(18,12),
  ADD COLUMN "fixedFeeTargetAmount" DECIMAL(36,18),
  ADD COLUMN "customerFeeSourceAmount" DECIMAL(36,18),
  ADD COLUMN "customerFeeSourceCurrency" "public"."CryptoCurrency",
  ADD COLUMN "customerFeeType" "public"."CustomerFeeType";
