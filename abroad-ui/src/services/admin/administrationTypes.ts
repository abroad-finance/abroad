export const opsRoles = [
  'VIEWER',
  'SUPPORT',
  'OPERATIONS',
  'FINANCE',
  'COMPLIANCE',
  'ADMINISTRATOR',
] as const

export type OpsAdministrationRole = typeof opsRoles[number]

export type OpsAuditEvent = {
  action: string
  actorKind: string
  actorLabel: string
  actorUserId: null | string
  createdAt: string
  id: string
  metadata: null | Record<string, boolean | null | number | string>
  reason: null | string
  reference: null | string
  resourceId: null | string
  resourceType: string
}

export type OpsAuditListResponse = {
  items: OpsAuditEvent[]
  page: number
  pageSize: number
  total: number
}

export type OpsAuditSearchFilters = {
  action?: string
  actor?: string
  createdFrom?: string
  createdTo?: string
  page?: number
  pageSize?: number
  resourceId?: string
  resourceType?: string
}

export type OpsUser = {
  createdAt: string
  disabledAt: null | string
  displayName: string
  email: string
  id: string
  lastLoginAt: null | string
  permissions: string[]
  role: OpsAdministrationRole
  sessionsRevokedAt: null | string
  sessionVersion: number
  status: 'ACTIVE' | 'DISABLED' | 'INVITED'
  updatedAt: string
  version: number
}

export type OpsUserInviteInput = {
  displayName: string
  email: string
  role: OpsAdministrationRole
}

export type OpsUserListResponse = {
  items: OpsUser[]
}
