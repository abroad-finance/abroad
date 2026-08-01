import { createHash, randomBytes } from 'node:crypto'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254

export class PartnerPortalCredentialValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalCredentialValidationError'
  }
}

export const buildPartnerPortalToken = (): { plaintext: string, tokenHash: string } => {
  const plaintext = randomBytes(32).toString('base64url')
  return { plaintext, tokenHash: hashPartnerPortalToken(plaintext) }
}

export const hashPartnerPortalToken = (token: string): string => {
  const normalized = token.trim()
  if (normalized.length < 32 || normalized.length > 256) {
    throw new PartnerPortalCredentialValidationError('Reset token is invalid')
  }
  return createHash('sha256').update(normalized, 'utf8').digest('base64url')
}

export const normalizePartnerPortalEmail = (email: string): string => {
  const normalized = email.trim().toLowerCase()
  if (
    normalized.length === 0
    || normalized.length > MAX_EMAIL_LENGTH
    || !EMAIL_PATTERN.test(normalized)
  ) {
    throw new PartnerPortalCredentialValidationError('Email is invalid')
  }
  return normalized
}
