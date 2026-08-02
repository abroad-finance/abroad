import type { OpsRole } from '@prisma/client'

import type { OpsPermission } from './opsPermissions'

export type OpsExternalIdentity = {
  authTime: Date
  displayName: string
  email: string
  provider: 'google.com'
  subject: string
}

export type OpsLegacyPrincipal = {
  authTime: null
  displayName: 'Legacy Ops key'
  email: null
  kind: 'ops_legacy'
  permissions: readonly OpsPermission[]
  role: null
  sessionVersion: null
  userId: null
}

export type OpsPrincipal = OpsLegacyPrincipal | OpsUserPrincipal

export type OpsUserPrincipal = {
  authTime: Date
  displayName: string
  email: string
  kind: 'ops_user'
  permissions: readonly OpsPermission[]
  role: OpsRole
  sessionVersion: number
  userId: string
}

export class OpsAuthenticationError extends Error {
  public constructor(message = 'Ops authentication could not be verified') {
    super(message)
    this.name = 'OpsAuthenticationError'
  }
}

export class OpsAuthorizationError extends Error {
  public constructor(message = 'You do not have permission to perform this action') {
    super(message)
    this.name = 'OpsAuthorizationError'
  }
}

export class OpsStepUpRequiredError extends Error {
  public constructor(message = 'Reauthenticate before performing this sensitive action') {
    super(message)
    this.name = 'OpsStepUpRequiredError'
  }
}

export const requireOpsPermission = (
  principal: OpsPrincipal,
  permission: OpsPermission,
): void => {
  if (!principal.permissions.includes(permission)) {
    throw new OpsAuthorizationError()
  }
}

export const requireOpsStepUp = (
  principal: OpsPrincipal,
  maximumAgeMs: number,
  now = new Date(),
): OpsUserPrincipal => {
  if (
    principal.kind !== 'ops_user'
    || now.getTime() - principal.authTime.getTime() > maximumAgeMs
  ) {
    throw new OpsStepUpRequiredError()
  }
  return principal
}
