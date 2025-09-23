CREATE VIEW "TransactionQuoteView" AS
SELECT
  t."id" AS "id",
  t."status" AS "transactionStatus",
  t."partnerUserId" AS "partnerUserId",
  t."accountNumber" AS "accountNumber",
  t."bankCode" AS "bankCode",
  t."createdAt" AS "transactionCreatedAt",
  t."quoteId" AS "quoteId",
  t."onChainId" AS "onChainId",
  t."taxId" AS "taxId",
  t."externalId" AS "externalId",
  t."qrCode" AS "qrCode",
  q."partnerId" AS "partnerId",
  q."targetAmount" AS "targetAmount",
  q."sourceAmount" AS "sourceAmount",
  q."targetCurrency" AS "targetCurrency",
  q."paymentMethod" AS "paymentMethod",
  q."country" AS "country",
  q."cryptoCurrency" AS "cryptoCurrency",
  q."network" AS "network",
  q."expirationDate" AS "expirationDate",
  q."createdAt" AS "quoteCreatedAt",
  q."updatedAt" AS "quoteUpdatedAt"
FROM "Transaction" AS t
JOIN "Quote" AS q ON q."id" = t."quoteId";
