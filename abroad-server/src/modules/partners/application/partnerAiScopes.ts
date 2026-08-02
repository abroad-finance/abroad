import { PartnerAiScope } from '@prisma/client'

export const partnerAiScopeNames = [
  'account:read',
  'docs:read',
  'requests:validate',
  'transactions:read',
  'webhooks:read',
  'offline_access',
] as const

export type PartnerAiScopeName = typeof partnerAiScopeNames[number]

const databaseScopeByName: Readonly<Record<PartnerAiScopeName, PartnerAiScope>> = {
  'account:read': PartnerAiScope.ACCOUNT_READ,
  'docs:read': PartnerAiScope.DOCS_READ,
  'offline_access': PartnerAiScope.OFFLINE_ACCESS,
  'requests:validate': PartnerAiScope.REQUESTS_VALIDATE,
  'transactions:read': PartnerAiScope.TRANSACTIONS_READ,
  'webhooks:read': PartnerAiScope.WEBHOOKS_READ,
}

const nameByDatabaseScope: Readonly<Record<PartnerAiScope, PartnerAiScopeName>> = {
  [PartnerAiScope.ACCOUNT_READ]: 'account:read',
  [PartnerAiScope.DOCS_READ]: 'docs:read',
  [PartnerAiScope.OFFLINE_ACCESS]: 'offline_access',
  [PartnerAiScope.REQUESTS_VALIDATE]: 'requests:validate',
  [PartnerAiScope.TRANSACTIONS_READ]: 'transactions:read',
  [PartnerAiScope.WEBHOOKS_READ]: 'webhooks:read',
}

export const partnerAiPermissionDescriptions: Readonly<Record<PartnerAiScopeName, string>> = {
  'account:read': 'View your Abroad organization name and connection permissions',
  'docs:read': 'Search Abroad public integration documentation',
  'offline_access': 'Keep this connection active when the AI client is not open',
  'requests:validate': 'Validate API request shape without sending the request',
  'transactions:read': 'View this organization’s transaction ledger and transaction diagnostics',
  'webhooks:read': 'View bounded webhook delivery health without URLs, payloads, or secrets',
}

const isPartnerAiScopeName = (value: string): value is PartnerAiScopeName => (
  (partnerAiScopeNames as readonly string[]).includes(value)
)

export const parsePartnerAiScopes = (scope: string): null | PartnerAiScopeName[] => {
  const rawValues = scope.split(/\s+/).map(value => value.trim()).filter(Boolean)
  const values = [...new Set(rawValues)]
  if (
    values.length === 0
    || values.length > partnerAiScopeNames.length
    || values.length !== rawValues.length
    || values.some(value => !isPartnerAiScopeName(value))
    || !values.includes('account:read')
  ) {
    return null
  }
  return values as PartnerAiScopeName[]
}

export const toDatabasePartnerAiScopes = (
  scopes: readonly PartnerAiScopeName[],
): PartnerAiScope[] => scopes.map(scope => databaseScopeByName[scope])

export const toPartnerAiScopeNames = (
  scopes: readonly PartnerAiScope[],
): PartnerAiScopeName[] => scopes.map(scope => nameByDatabaseScope[scope])

export const requiresPartnerAiMfa = (scopes: readonly PartnerAiScopeName[]): boolean => (
  scopes.includes('webhooks:read')
)

export const formatPartnerAiScope = (scopes: readonly PartnerAiScopeName[]): string => (
  partnerAiScopeNames.filter(scope => scopes.includes(scope)).join(' ')
)
