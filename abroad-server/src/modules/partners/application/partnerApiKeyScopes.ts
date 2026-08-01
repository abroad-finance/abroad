import { PartnerApiKeyScope } from '@prisma/client'

export const partnerApiKeyScopeNames = [
  'transactions:read',
  'transactions:write',
  'partner-users:read',
  'partner-users:write',
  'kyc:read',
  'kyc:write',
  'telemetry:write',
] as const

export type PartnerApiKeyScopeName = typeof partnerApiKeyScopeNames[number]

const databaseScopeByName: Readonly<Record<PartnerApiKeyScopeName, PartnerApiKeyScope>> = {
  'kyc:read': PartnerApiKeyScope.KYC_READ,
  'kyc:write': PartnerApiKeyScope.KYC_WRITE,
  'partner-users:read': PartnerApiKeyScope.PARTNER_USERS_READ,
  'partner-users:write': PartnerApiKeyScope.PARTNER_USERS_WRITE,
  'telemetry:write': PartnerApiKeyScope.TELEMETRY_WRITE,
  'transactions:read': PartnerApiKeyScope.TRANSACTIONS_READ,
  'transactions:write': PartnerApiKeyScope.TRANSACTIONS_WRITE,
}

const scopeNameByDatabaseScope = new Map<PartnerApiKeyScope, PartnerApiKeyScopeName>(
  Object.entries(databaseScopeByName).map(([name, scope]) => [
    scope,
    name as PartnerApiKeyScopeName,
  ]),
)

export const fromDatabasePartnerApiKeyScope = (
  scope: PartnerApiKeyScope,
): PartnerApiKeyScopeName => {
  const scopeName = scopeNameByDatabaseScope.get(scope)
  if (!scopeName) {
    throw new Error('Managed API key contains an unsupported scope')
  }
  return scopeName
}

export const isPartnerApiKeyScopeName = (value: string): value is PartnerApiKeyScopeName => (
  partnerApiKeyScopeNames.some(scope => scope === value)
)

export const toDatabasePartnerApiKeyScope = (
  scope: PartnerApiKeyScopeName,
): PartnerApiKeyScope => databaseScopeByName[scope]
