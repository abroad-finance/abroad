import { randomBytes } from 'crypto'

import { sha512_224 } from 'js-sha512'

const PARTNER_API_KEY_PREFIX = 'partner_'
const PARTNER_API_KEY_BYTES = 24

type PartnerApiKeyCandidate = {
  hashed: string
  plaintext: string
}

export const hashPartnerApiKey = (apiKey: string): string => {
  const normalized = apiKey.trim()
  if (!normalized) {
    throw new Error('API key not provided')
  }
  return sha512_224(normalized)
}

export const buildPartnerApiKeyCandidate = (): PartnerApiKeyCandidate => {
  const plaintext = `${PARTNER_API_KEY_PREFIX}${randomBytes(PARTNER_API_KEY_BYTES).toString('base64url')}`
  return {
    hashed: hashPartnerApiKey(plaintext),
    plaintext,
  }
}
