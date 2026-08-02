import 'reflect-metadata'

import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { PartnerPortalSecretEnvelopeError, PartnerPortalSecretEnvelopeService } from '../../../../modules/partners/application/PartnerPortalSecretEnvelopeService'

const encryptionKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
  .toString('base64url')

const buildSecretManager = (
  getSecret: ISecretManager['getSecret'] = jest.fn(async () => encryptionKey),
): ISecretManager => ({
  getSecret,
  getSecrets: jest.fn(),
})

const tamperAuthenticationTag = (envelope: string): string => {
  const [version = '', initializationVector = '', encodedAuthTag = '', ciphertext = '']
    = envelope.split('.')
  const authTag = Buffer.from(encodedAuthTag, 'base64url')
  const firstByte = authTag.at(0)
  if (firstByte === undefined) {
    throw new Error('Expected a non-empty authentication tag')
  }
  authTag[0] = firstByte ^ 0x01
  return [version, initializationVector, authTag.toString('base64url'), ciphertext].join('.')
}

describe('PartnerPortalSecretEnvelopeService', () => {
  it('round-trips a secret only under the exact authenticated context', async () => {
    const service = new PartnerPortalSecretEnvelopeService(buildSecretManager())
    const envelope = await service.encrypt('whsec_sensitive-value', 'partner:webhook:one')

    await expect(service.decrypt(envelope, 'partner:webhook:one')).resolves.toBe(
      'whsec_sensitive-value',
    )
    await expect(service.decrypt(envelope, 'partner:webhook:two')).rejects.toThrow(
      new PartnerPortalSecretEnvelopeError('Encrypted secret could not be opened'),
    )
    expect(envelope).not.toContain('whsec_sensitive-value')
  })

  it('uses a fresh initialization vector for every envelope', async () => {
    const service = new PartnerPortalSecretEnvelopeService(buildSecretManager())

    const first = await service.encrypt('same-value', 'same-context')
    const second = await service.encrypt('same-value', 'same-context')

    expect(first).not.toBe(second)
    await expect(service.decrypt(first, 'same-context')).resolves.toBe('same-value')
    await expect(service.decrypt(second, 'same-context')).resolves.toBe('same-value')
  })

  it('rejects malformed and tampered envelopes with a bounded error', async () => {
    const service = new PartnerPortalSecretEnvelopeService(buildSecretManager())
    const envelope = await service.encrypt('managed-secret', 'context')
    const tampered = tamperAuthenticationTag(envelope)

    await expect(service.decrypt('not-an-envelope', 'context')).rejects.toThrow(
      'Encrypted secret envelope is invalid',
    )
    await expect(service.decrypt(tampered, 'context')).rejects.toThrow(
      'Encrypted secret could not be opened',
    )
  })

  it('does not cache a failed key lookup and accepts a corrected 32-byte key', async () => {
    const getSecret = jest.fn<ReturnType<ISecretManager['getSecret']>, Parameters<ISecretManager['getSecret']>>()
      .mockResolvedValueOnce('invalid-key')
      .mockResolvedValueOnce(encryptionKey)
    const service = new PartnerPortalSecretEnvelopeService(buildSecretManager(getSecret))

    await expect(service.encrypt('secret', 'context')).rejects.toThrow(
      'Partner portal encryption key is not configured securely',
    )
    await expect(service.encrypt('secret', 'context')).resolves.toMatch(/^v1\./u)
    expect(getSecret).toHaveBeenCalledTimes(2)
  })

  it('rejects empty plaintext and invalid authenticated contexts', async () => {
    const service = new PartnerPortalSecretEnvelopeService(buildSecretManager())

    await expect(service.encrypt('', 'context')).rejects.toThrow('Secret must not be empty')
    await expect(service.encrypt('secret', '   ')).rejects.toThrow('Secret context is invalid')
  })
})
