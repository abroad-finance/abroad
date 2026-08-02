type PartnerAiOAuthErrorCode
  = | 'invalid_client'
    | 'invalid_grant'
    | 'invalid_request'
    | 'invalid_scope'
    | 'server_error'
    | 'temporarily_unavailable'
    | 'unsupported_grant_type'

type PartnerAiPortalErrorCode
  = | 'ADMIN_REQUIRED'
    | 'ALREADY_RESOLVED'
    | 'CONNECTION_INACTIVE'
    | 'MFA_REQUIRED'
    | 'NOT_FOUND'
    | 'REQUEST_EXPIRED'
    | 'UNSUPPORTED_CLIENT'

export class PartnerAiOAuthError extends Error {
  public constructor(
    public readonly code: PartnerAiOAuthErrorCode,
    message = 'The AI connection request could not be completed',
  ) {
    super(message)
    this.name = 'PartnerAiOAuthError'
  }
}

export class PartnerAiPortalError extends Error {
  public constructor(
    public readonly code: PartnerAiPortalErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PartnerAiPortalError'
  }
}
