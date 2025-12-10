-- Add dedicated storage for hashed client domains to decouple them from API keys
ALTER TABLE "Partner" ADD COLUMN     "clientDomainHash" TEXT;

CREATE UNIQUE INDEX "Partner_clientDomainHash_key" ON "Partner"("clientDomainHash");
