export type OpsHandoffBoard = {
  counts: { mine: number, total: number, unowned: number }
  generatedAt: string
  items: OpsHandoffWorkItem[]
  scope: OpsHandoffScope
}
export type OpsHandoffScope = 'ALL' | 'MINE' | 'UNOWNED'
export type OpsHandoffWorkItem = {
  ageSeconds: number
  href: string
  id: string
  latestEscalation: null | {
    at: string
    author: string
    summary: string
  }
  owner: null | OpsIncidentUser
  priority: string
  resourceType: 'CASE' | 'INCIDENT'
  status: OpsWorkStatus
  subtitle: string
  team: null | string
  title: string
  updatedAt: string
  version: number
}

export type OpsIncidentAffectedResource = {
  id: string
  label: string
  path: string
  type: 'BRIDGE_BATCH' | 'BRIDGE_LEG' | 'FLOW' | 'PARTNER' | 'TRANSACTION'
}

export type OpsIncidentContext = {
  affected: OpsIncidentAffectedResource[]
  dimensions: Array<{ label: string, value: string }>
  filters: Array<{ label: string, path: string }>
}

export type OpsIncidentDetail = OpsIncidentSummary & {
  handoffs: Array<{
    actor: OpsIncidentUser
    createdAt: string
    fromTeam: null | string
    fromUser: null | OpsIncidentUser
    id: string
    note: string
    toTeam: null | string
    toUser: null | OpsIncidentUser
  }>
  notes: Array<{
    author: OpsIncidentUser
    body: string
    createdAt: string
    id: string
    kind: OpsNoteKind
  }>
}

export type OpsIncidentListResponse = {
  items: OpsIncidentSummary[]
  page: number
  pageSize: number
  severityCounts: Array<{ count: number, value: OpsIncidentSeverity }>
  statusCounts: Array<{ count: number, value: OpsWorkStatus }>
  total: number
}

export type OpsIncidentOverview = {
  critical: number
  high: number
  open: number
  top: OpsIncidentSummary[]
  unowned: number
}

export type OpsIncidentOwnerOption = OpsIncidentUser & {
  role: string
}

export type OpsIncidentRunbook = {
  description: string
  id: string
  name: string
  slug: string
  url: string
}

export type OpsIncidentSeverity = 'CRITICAL' | 'HIGH' | 'INFO' | 'WARNING'

export type OpsIncidentSummary = {
  acknowledgedAt: null | string
  affectedCount: number
  ageSeconds: number
  context: OpsIncidentContext
  firstSeenAt: string
  id: string
  kind: string
  lastSeenAt: string
  occurrenceCount: number
  owner: null | OpsIncidentUser
  resolvedAt: null | string
  runbook: null | OpsIncidentRunbook
  severity: OpsIncidentSeverity
  status: OpsWorkStatus
  summary: string
  team: null | string
  title: string
  updatedAt: string
  version: number
}

export type OpsIncidentUser = {
  displayName: string
  id: string
}

export type OpsNoteKind = 'ESCALATION' | 'NOTE' | 'RESOLUTION'

export type OpsWorkStatus = 'ACKNOWLEDGED' | 'OPEN' | 'RESOLVED'
