CREATE TYPE "public"."PartnerAiClientKind" AS ENUM ('GENERIC');
CREATE TYPE "public"."PartnerAiScope" AS ENUM (
  'ACCOUNT_READ',
  'DOCS_READ',
  'REQUESTS_VALIDATE',
  'TRANSACTIONS_READ',
  'WEBHOOKS_READ',
  'OFFLINE_ACCESS'
);
CREATE TYPE "public"."PartnerAiAuthorizationOutcome" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

CREATE TABLE "public"."PartnerAiOAuthClient" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "clientName" TEXT NOT NULL,
  "redirectUris" TEXT[] NOT NULL,
  "allowedScopes" "public"."PartnerAiScope"[] NOT NULL,
  "clientUri" TEXT,
  "verifiedKind" "public"."PartnerAiClientKind" NOT NULL DEFAULT 'GENERIC',
  "disabledAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerAiOAuthClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerAiAuthorizationRequest" (
  "id" TEXT NOT NULL,
  "oauthClientId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "stateCiphertext" TEXT,
  "scopes" "public"."PartnerAiScope"[] NOT NULL,
  "resource" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "fingerprintHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "outcome" "public"."PartnerAiAuthorizationOutcome" NOT NULL DEFAULT 'PENDING',
  "resolvedAt" TIMESTAMP(3),
  "partnerId" TEXT,
  "actorUserId" TEXT,
  "connectionId" TEXT,
  "codeHash" TEXT,
  "codeExpiresAt" TIMESTAMP(3),
  "codeConsumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerAiAuthorizationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerAiConnection" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "oauthClientId" TEXT NOT NULL,
  "authorizedByUserId" TEXT,
  "scopes" "public"."PartnerAiScope"[] NOT NULL,
  "activeGrantKey" TEXT,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "lastTestedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerAiConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerAiAccessToken" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scopes" "public"."PartnerAiScope"[] NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerAiAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PartnerAiRefreshToken" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "scopes" "public"."PartnerAiScope"[] NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "replacedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerAiRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerAiOAuthClient_clientId_key" ON "public"."PartnerAiOAuthClient"("clientId");
CREATE INDEX "PartnerAiOAuthClient_disabledAt_createdAt_idx" ON "public"."PartnerAiOAuthClient"("disabledAt", "createdAt");

CREATE UNIQUE INDEX "PartnerAiAuthorizationRequest_fingerprintHash_key" ON "public"."PartnerAiAuthorizationRequest"("fingerprintHash");
CREATE UNIQUE INDEX "PartnerAiAuthorizationRequest_connectionId_key" ON "public"."PartnerAiAuthorizationRequest"("connectionId");
CREATE UNIQUE INDEX "PartnerAiAuthorizationRequest_codeHash_key" ON "public"."PartnerAiAuthorizationRequest"("codeHash");
CREATE INDEX "PartnerAiAuthorizationRequest_oauthClientId_expiresAt_outcome_idx" ON "public"."PartnerAiAuthorizationRequest"("oauthClientId", "expiresAt", "outcome");
CREATE INDEX "PartnerAiAuthorizationRequest_partnerId_createdAt_idx" ON "public"."PartnerAiAuthorizationRequest"("partnerId", "createdAt");

CREATE UNIQUE INDEX "PartnerAiConnection_activeGrantKey_key" ON "public"."PartnerAiConnection"("activeGrantKey");
CREATE INDEX "PartnerAiConnection_partnerId_createdAt_idx" ON "public"."PartnerAiConnection"("partnerId", "createdAt");
CREATE INDEX "PartnerAiConnection_oauthClientId_createdAt_idx" ON "public"."PartnerAiConnection"("oauthClientId", "createdAt");
CREATE INDEX "PartnerAiConnection_partnerId_revokedAt_failedAt_expiresAt_idx" ON "public"."PartnerAiConnection"("partnerId", "revokedAt", "failedAt", "expiresAt");

CREATE UNIQUE INDEX "PartnerAiAccessToken_tokenHash_key" ON "public"."PartnerAiAccessToken"("tokenHash");
CREATE INDEX "PartnerAiAccessToken_connectionId_expiresAt_revokedAt_idx" ON "public"."PartnerAiAccessToken"("connectionId", "expiresAt", "revokedAt");

CREATE UNIQUE INDEX "PartnerAiRefreshToken_tokenHash_key" ON "public"."PartnerAiRefreshToken"("tokenHash");
CREATE UNIQUE INDEX "PartnerAiRefreshToken_replacedById_key" ON "public"."PartnerAiRefreshToken"("replacedById");
CREATE INDEX "PartnerAiRefreshToken_connectionId_expiresAt_revokedAt_idx" ON "public"."PartnerAiRefreshToken"("connectionId", "expiresAt", "revokedAt");
CREATE INDEX "PartnerAiRefreshToken_familyId_createdAt_idx" ON "public"."PartnerAiRefreshToken"("familyId", "createdAt");

ALTER TABLE "public"."PartnerAiAuthorizationRequest"
  ADD CONSTRAINT "PartnerAiAuthorizationRequest_oauthClientId_fkey"
  FOREIGN KEY ("oauthClientId") REFERENCES "public"."PartnerAiOAuthClient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiAuthorizationRequest"
  ADD CONSTRAINT "PartnerAiAuthorizationRequest_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiAuthorizationRequest"
  ADD CONSTRAINT "PartnerAiAuthorizationRequest_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "public"."PartnerPortalUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiAuthorizationRequest"
  ADD CONSTRAINT "PartnerAiAuthorizationRequest_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "public"."PartnerAiConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiConnection"
  ADD CONSTRAINT "PartnerAiConnection_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiConnection"
  ADD CONSTRAINT "PartnerAiConnection_oauthClientId_fkey"
  FOREIGN KEY ("oauthClientId") REFERENCES "public"."PartnerAiOAuthClient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiConnection"
  ADD CONSTRAINT "PartnerAiConnection_authorizedByUserId_fkey"
  FOREIGN KEY ("authorizedByUserId") REFERENCES "public"."PartnerPortalUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiAccessToken"
  ADD CONSTRAINT "PartnerAiAccessToken_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "public"."PartnerAiConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiRefreshToken"
  ADD CONSTRAINT "PartnerAiRefreshToken_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "public"."PartnerAiConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."PartnerAiRefreshToken"
  ADD CONSTRAINT "PartnerAiRefreshToken_replacedById_fkey"
  FOREIGN KEY ("replacedById") REFERENCES "public"."PartnerAiRefreshToken"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
