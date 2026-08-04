-- Historical fee terms cannot be reconstructed authoritatively and remain NULL.
-- Destination country is deterministic from the immutable settlement currency.
UPDATE "public"."Quote"
SET "country" = CASE
  WHEN "targetCurrency" = 'BRL' THEN 'BR'::"public"."Country"
  ELSE 'CO'::"public"."Country"
END
WHERE
  ("targetCurrency" = 'BRL' AND "country" <> 'BR'::"public"."Country")
  OR ("targetCurrency" = 'COP' AND "country" <> 'CO'::"public"."Country");
