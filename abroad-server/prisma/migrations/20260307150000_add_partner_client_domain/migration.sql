-- Store the canonical client domain so ops can manage browser-origin auth without manual hashing
ALTER TABLE "Partner" ADD COLUMN     "clientDomain" TEXT;

CREATE UNIQUE INDEX "Partner_clientDomain_key" ON "Partner"("clientDomain");
