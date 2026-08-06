-- Soroban transactions cannot carry a memo: the network rejects any transaction
-- that contains both a Soroban operation and one. The memo is how this rail
-- correlates a deposit to a transaction, so confidential deposits arrive through
-- an Abroad wrapper contract that carries the reference as an explicit argument.
--
-- Nullable, so the column is additive. A row without it resolves as unconfigured,
-- which keeps an asset that predates the wrapper from accepting deposits it could
-- not attribute.

-- AlterTable
ALTER TABLE "public"."ConfidentialAssetConfig" ADD COLUMN     "depositContractAddress" TEXT;
