SELECT
  t.id,
  t.status AS "transactionStatus",
  t."partnerUserId",
  t."accountNumber",
  t."bankCode",
  t."createdAt" AS "transactionCreatedAt",
  t."quoteId",
  t."onChainId",
  t."refundOnChainId",
  t."taxId",
  t."externalId",
  t."qrCode",
  q."partnerId",
  q."targetAmount",
  q."sourceAmount",
  q."targetCurrency",
  q."paymentMethod",
  q.country,
  q."cryptoCurrency",
  q.network,
  q."expirationDate",
  q."createdAt" AS "quoteCreatedAt",
  q."updatedAt" AS "quoteUpdatedAt"
FROM
  (
    "Transaction" t
    JOIN "Quote" q ON ((q.id = t."quoteId"))
  );