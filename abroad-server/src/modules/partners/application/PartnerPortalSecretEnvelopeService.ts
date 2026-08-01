import { inject, injectable } from 'inversify'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { TYPES } from '../../../app/container/types'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'

const ALGORITHM = 'aes-256-gcm'
const AUTH_TAG_BYTES = 16
const ENCRYPTION_KEY_BYTES = 32
const ENVELOPE_VERSION = 'v1'
const INITIALIZATION_VECTOR_BYTES = 12

export class PartnerPortalSecretEnvelopeError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalSecretEnvelopeError'
  }
}

@injectable()
export class PartnerPortalSecretEnvelopeService {
  private encryptionKeyPromise?: Promise<Buffer>

  public constructor(
    @inject(TYPES.ISecretManager)
    private readonly secretManager: ISecretManager,
  ) {}

  public async decrypt(envelope: string, context: string): Promise<string> {
    const normalizedContext = this.normalizeContext(context)
    const parts = envelope.split('.')
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
      throw new PartnerPortalSecretEnvelopeError('Encrypted secret envelope is invalid')
    }

    try {
      const initializationVector = Buffer.from(parts[1], 'base64url')
      const authTag = Buffer.from(parts[2], 'base64url')
      const ciphertext = Buffer.from(parts[3], 'base64url')
      if (
        initializationVector.length !== INITIALIZATION_VECTOR_BYTES
        || authTag.length !== AUTH_TAG_BYTES
        || ciphertext.length === 0
      ) {
        throw new Error('Invalid envelope component length')
      }

      const decipher = createDecipheriv(
        ALGORITHM,
        await this.getEncryptionKey(),
        initializationVector,
        { authTagLength: AUTH_TAG_BYTES },
      )
      decipher.setAAD(Buffer.from(normalizedContext, 'utf8'))
      decipher.setAuthTag(authTag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    }
    catch (error) {
      if (error instanceof PartnerPortalSecretEnvelopeError) {
        throw error
      }
      throw new PartnerPortalSecretEnvelopeError('Encrypted secret could not be opened')
    }
  }

  public async encrypt(plaintext: string, context: string): Promise<string> {
    if (!plaintext) {
      throw new PartnerPortalSecretEnvelopeError('Secret must not be empty')
    }
    const normalizedContext = this.normalizeContext(context)
    const initializationVector = randomBytes(INITIALIZATION_VECTOR_BYTES)
    const cipher = createCipheriv(
      ALGORITHM,
      await this.getEncryptionKey(),
      initializationVector,
      { authTagLength: AUTH_TAG_BYTES },
    )
    cipher.setAAD(Buffer.from(normalizedContext, 'utf8'))
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    return [
      ENVELOPE_VERSION,
      initializationVector.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.')
  }

  private async fetchEncryptionKey(): Promise<Buffer> {
    const encodedKey = await this.secretManager.getSecret(
      Secrets.PARTNER_PORTAL_DATA_ENCRYPTION_KEY,
    )
    let key: Buffer
    try {
      key = Buffer.from(encodedKey.trim(), 'base64url')
    }
    catch {
      throw new PartnerPortalSecretEnvelopeError(
        'Partner portal encryption key is not configured securely',
      )
    }
    if (key.length !== ENCRYPTION_KEY_BYTES) {
      throw new PartnerPortalSecretEnvelopeError(
        'Partner portal encryption key is not configured securely',
      )
    }
    return key
  }

  private getEncryptionKey(): Promise<Buffer> {
    if (!this.encryptionKeyPromise) {
      this.encryptionKeyPromise = this.fetchEncryptionKey().catch((error: unknown) => {
        this.encryptionKeyPromise = undefined
        throw error
      })
    }
    return this.encryptionKeyPromise
  }

  private normalizeContext(context: string): string {
    const normalized = context.trim()
    if (!normalized || normalized.length > 512) {
      throw new PartnerPortalSecretEnvelopeError('Secret context is invalid')
    }
    return normalized
  }
}
