import type { OpsExternalIdentity, OpsPrincipal, OpsUserPrincipal } from '../../modules/operations/application/opsIdentity'
import type { AuthenticatedPartner } from '../../modules/partners/application/contracts/IPartnerService'
import type { PartnerPortalPrincipal } from '../../modules/partners/application/PartnerPortalSessionService'

export type OpsExternalAuthentication = OpsExternalIdentity & { kind: 'ops_external' }

export type RequestAuthentication
  = | AuthenticatedPartner
    | OpsExternalAuthentication
    | OpsPrincipal
    | PartnerPortalPrincipal

export const requireAuthenticatedPartner = (
  authentication: RequestAuthentication | undefined,
): AuthenticatedPartner => {
  if (!authentication || 'kind' in authentication) {
    throw new Error('Authenticated partner context is unavailable')
  }
  return authentication
}

export const requirePartnerPortalPrincipal = (
  authentication: RequestAuthentication | undefined,
): PartnerPortalPrincipal => {
  if (!authentication || !('kind' in authentication) || authentication.kind !== 'partner_portal') {
    throw new Error('Partner portal authentication context is unavailable')
  }
  return authentication
}

export const requirePartnerPortalAdministrator = (
  authentication: RequestAuthentication | undefined,
): PartnerPortalPrincipal => {
  const principal = requirePartnerPortalPrincipal(authentication)
  if (principal.role !== 'ADMIN') {
    throw new Error('Partner portal administrator access is required')
  }
  return principal
}

export const requirePartnerPortalMfaAdministrator = (
  authentication: RequestAuthentication | undefined,
): PartnerPortalPrincipal => {
  const principal = requirePartnerPortalAdministrator(authentication)
  if (!principal.mfaEnabled || !principal.mfaVerified) {
    throw new Error('Partner portal MFA verification is required')
  }
  return principal
}

export const requireOpsExternalIdentity = (
  authentication: RequestAuthentication | undefined,
): OpsExternalIdentity => {
  if (!authentication || !('kind' in authentication) || authentication.kind !== 'ops_external') {
    throw new Error('External Ops authentication context is unavailable')
  }
  return authentication
}

export const requireOpsPrincipal = (
  authentication: RequestAuthentication | undefined,
): OpsPrincipal => {
  if (
    !authentication
    || !('kind' in authentication)
    || (authentication.kind !== 'ops_user' && authentication.kind !== 'ops_legacy')
  ) {
    throw new Error('Ops authentication context is unavailable')
  }
  return authentication
}

export const requireNamedOpsPrincipal = (
  authentication: RequestAuthentication | undefined,
): OpsUserPrincipal => {
  const principal = requireOpsPrincipal(authentication)
  if (principal.kind !== 'ops_user') {
    throw new Error('Named Ops authentication is required')
  }
  return principal
}
