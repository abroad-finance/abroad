import type { AuthenticatedPartner } from '../../modules/partners/application/contracts/IPartnerService'
import type { PartnerPortalPrincipal } from '../../modules/partners/application/PartnerPortalSessionService'

export type OpsAuthentication = { kind: 'ops' }

export type RequestAuthentication
  = | AuthenticatedPartner
    | OpsAuthentication
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
