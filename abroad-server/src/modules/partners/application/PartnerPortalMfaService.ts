import { injectable } from 'inversify'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const RECOVERY_CODE_BYTES = 10
const RECOVERY_CODE_COUNT = 10
const TOTP_CODE_PATTERN = /^\d{6}$/
const TOTP_DIGITS = 6
const TOTP_SECRET_BYTES = 20
const TOTP_STEP_SECONDS = 30
const TOTP_WINDOW = 1

type PartnerPortalMfaEnrollment = {
  manualEntryKey: string
  otpauthUri: string
  secret: string
}

type PartnerPortalRecoveryCode = {
  codeHash: string
  plaintext: string
}

export class PartnerPortalMfaValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalMfaValidationError'
  }
}

@injectable()
export class PartnerPortalMfaService {
  public buildEnrollment(email: string, partnerName: string): PartnerPortalMfaEnrollment {
    const secret = this.encodeBase32(randomBytes(TOTP_SECRET_BYTES))
    const issuer = 'Abroad'
    const label = `${issuer}:${partnerName} (${email})`
    const parameters = new URLSearchParams({
      algorithm: 'SHA1',
      digits: String(TOTP_DIGITS),
      issuer,
      period: String(TOTP_STEP_SECONDS),
      secret,
    })
    return {
      manualEntryKey: secret.match(/.{1,4}/g)?.join(' ') ?? secret,
      otpauthUri: `otpauth://totp/${encodeURIComponent(label)}?${parameters.toString()}`,
      secret,
    }
  }

  public generateRecoveryCodes(): PartnerPortalRecoveryCode[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const normalized = this.encodeBase32(randomBytes(RECOVERY_CODE_BYTES))
      return {
        codeHash: this.hashRecoveryCode(normalized),
        plaintext: normalized.match(/.{1,4}/g)?.join('-') ?? normalized,
      }
    })
  }

  public hashRecoveryCode(code: string): string {
    const normalized = this.normalizeRecoveryCode(code)
    return createHash('sha256').update(normalized, 'utf8').digest('base64url')
  }

  public verifyTotp(
    secret: string,
    code: string,
    lastUsedCounter: bigint | null,
    now: Date = new Date(),
  ): bigint {
    const normalizedCode = code.trim()
    if (!TOTP_CODE_PATTERN.test(normalizedCode)) {
      throw new PartnerPortalMfaValidationError('Authentication code is invalid')
    }

    const currentCounter = BigInt(Math.floor(now.getTime() / 1_000 / TOTP_STEP_SECONDS))
    for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
      const counter = currentCounter + BigInt(offset)
      if (counter < 0n || (lastUsedCounter !== null && counter <= lastUsedCounter)) {
        continue
      }
      const expectedCode = this.generateTotp(secret, counter)
      if (timingSafeEqual(Buffer.from(expectedCode), Buffer.from(normalizedCode))) {
        return counter
      }
    }

    throw new PartnerPortalMfaValidationError('Authentication code is invalid')
  }

  private decodeBase32(value: string): Buffer {
    const normalized = value.toUpperCase().replace(/=+$/u, '')
    let bits = 0
    let bitCount = 0
    const bytes: number[] = []
    for (const character of normalized) {
      const alphabetIndex = BASE32_ALPHABET.indexOf(character)
      if (alphabetIndex < 0) {
        throw new PartnerPortalMfaValidationError('MFA secret is invalid')
      }
      bits = (bits << 5) | alphabetIndex
      bitCount += 5
      if (bitCount >= 8) {
        bytes.push((bits >>> (bitCount - 8)) & 0xff)
        bitCount -= 8
      }
    }
    return Buffer.from(bytes)
  }

  private encodeBase32(value: Buffer): string {
    let bits = 0
    let bitCount = 0
    let result = ''
    for (const byte of value) {
      bits = (bits << 8) | byte
      bitCount += 8
      while (bitCount >= 5) {
        result += BASE32_ALPHABET[(bits >>> (bitCount - 5)) & 31]
        bitCount -= 5
      }
    }
    if (bitCount > 0) {
      result += BASE32_ALPHABET[(bits << (5 - bitCount)) & 31]
    }
    return result
  }

  private generateTotp(secret: string, counter: bigint): string {
    const counterBuffer = Buffer.alloc(8)
    counterBuffer.writeBigUInt64BE(counter)
    const digest = createHmac('sha1', this.decodeBase32(secret))
      .update(counterBuffer)
      .digest()
    const offset = digest[digest.length - 1] & 0x0f
    const binary = (
      ((digest[offset] & 0x7f) << 24)
      | ((digest[offset + 1] & 0xff) << 16)
      | ((digest[offset + 2] & 0xff) << 8)
      | (digest[offset + 3] & 0xff)
    )
    return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0')
  }

  private normalizeRecoveryCode(code: string): string {
    const normalized = code.toUpperCase().replace(/[^A-Z2-7]/gu, '')
    if (normalized.length !== RECOVERY_CODE_BYTES * 8 / 5) {
      throw new PartnerPortalMfaValidationError('Recovery code is invalid')
    }
    return normalized
  }
}
