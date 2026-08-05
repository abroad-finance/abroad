import { ApplicationError } from '../../core/errors'

/**
 * Raised when a suspended Partner authenticates. Separate from
 * DisabledUserError so the caller can tell "this end user is blocked" from
 * "the whole integration is frozen".
 */
export class DisabledPartnerError extends ApplicationError {
  constructor(message = 'This partner account has been suspended. Please contact support.') {
    super(403, 'partner_disabled', message)
    this.name = 'DisabledPartnerError'
  }
}

/**
 * Raised when an operator-disabled PartnerUser attempts any authenticated action.
 * Maps to HTTP 403 via mapErrorToHttpResponse.
 */
export class DisabledUserError extends ApplicationError {
  constructor(message = 'This account has been disabled. Please contact support.') {
    super(403, 'user_disabled', message)
    this.name = 'DisabledUserError'
  }
}

/**
 * Guard invoked wherever a Partner is resolved from a credential (API key,
 * client domain, SEP bearer token). A partner is suspended when `disabledAt`
 * is set; suspending is reversible from the Ops dashboard.
 */
export function assertPartnerEnabled(partner: { disabledAt?: Date | null }): void {
  if (partner.disabledAt) {
    throw new DisabledPartnerError()
  }
}

/**
 * Guard invoked wherever a PartnerUser is resolved for an action (transaction
 * acceptance, KYC submission, ...). A user is disabled when `disabledAt` is set;
 * disabling is reversible from the Ops dashboard.
 */
export function assertPartnerUserEnabled(partnerUser: { disabledAt: Date | null }): void {
  if (partnerUser.disabledAt !== null) {
    throw new DisabledUserError()
  }
}
