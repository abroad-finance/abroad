import { ApplicationError } from '../../core/errors'

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
 * Guard invoked wherever a PartnerUser is resolved for an action (transaction
 * acceptance, KYC submission, ...). A user is disabled when `disabledAt` is set;
 * disabling is reversible from the Ops dashboard.
 */
export function assertPartnerUserEnabled(partnerUser: { disabledAt: Date | null }): void {
  if (partnerUser.disabledAt !== null) {
    throw new DisabledUserError()
  }
}
