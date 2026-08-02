export type OpsIntegration = OpsIntegrationInput & {
  createdAt: string
  id: string
  lastCheckedAt: null | string
  lastErrorCode: null | string
  updatedAt: string
  version: number
}
export type OpsIntegrationCatalog = {
  integrations: OpsIntegration[]
  runbooks: OpsRunbook[]
}

export type OpsIntegrationConfiguration = {
  destinationLabel?: null | string
  eventKinds?: string[]
  healthcheckName?: null | string
  provider?: null | string
}

export type OpsIntegrationInput = {
  configuration: OpsIntegrationConfiguration
  description: string
  kind: OpsIntegrationKind
  name: string
  status: OpsIntegrationStatus
}

export type OpsIntegrationKind = 'NOTIFICATION' | 'PROVIDER' | 'RUNBOOK' | 'WEBHOOK'

export type OpsIntegrationStatus = 'ACTIVE' | 'DEGRADED' | 'DISABLED'

export type OpsRunbook = OpsRunbookInput & {
  createdAt: string
  id: string
  updatedAt: string
  version: number
}

export type OpsRunbookInput = {
  active: boolean
  description: string
  incidentKinds: string[]
  name: string
  slug: string
  url: string
}
