import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const generatePartnerAiCredential = (prefix: string): string => (
  `${prefix}${randomBytes(32).toString('base64url')}`
)

export const hashPartnerAiCredential = (credential: string): string => (
  createHash('sha256').update(credential, 'utf8').digest('base64url')
)

export const buildPartnerAiFingerprint = (values: readonly string[]): string => (
  createHash('sha256')
    .update(values.map(value => `${value.length}:${value}`).join('|'), 'utf8')
    .digest('base64url')
)

export const verifyPartnerAiPkce = (verifier: string, expectedChallenge: string): boolean => {
  const actualChallenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  const actualBuffer = Buffer.from(actualChallenge, 'utf8')
  const expectedBuffer = Buffer.from(expectedChallenge, 'utf8')
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}
