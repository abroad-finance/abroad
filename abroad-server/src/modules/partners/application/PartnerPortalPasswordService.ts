import { injectable } from 'inversify'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const VERIFIER_PREFIX = 'scrypt-v1'
const CURRENT_N = 32_768
const CURRENT_R = 8
const CURRENT_P = 1
const DERIVED_KEY_BYTES = 64
const SALT_BYTES = 32
const MAX_MEMORY_BYTES = 128 * 1024 * 1024
const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128
const MIN_ACCEPTED_N = 16_384
const MAX_ACCEPTED_N = 131_072
const DUMMY_SALT = Buffer.from('abroad-partner-portal-dummy-salt-v1', 'utf8')
const VERIFIER_PATTERN = /^scrypt-v1\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/

type ParsedVerifier = ScryptParameters & {
  derivedKey: Buffer
  salt: Buffer
}

type ScryptParameters = {
  N: number
  p: number
  r: number
}

export class PartnerPortalPasswordValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalPasswordValidationError'
  }
}

@injectable()
export class PartnerPortalPasswordService {
  public async buildVerifier(password: string): Promise<string> {
    this.validatePassword(password)
    const salt = randomBytes(SALT_BYTES)
    const parameters = this.currentParameters()
    const derivedKey = await this.deriveKey(password, salt, parameters)

    return [
      VERIFIER_PREFIX,
      `N=${parameters.N},r=${parameters.r},p=${parameters.p}`,
      salt.toString('base64url'),
      derivedKey.toString('base64url'),
    ].join('$')
  }

  public async performDummyVerification(password: string): Promise<void> {
    const boundedPassword = password.slice(0, MAX_PASSWORD_LENGTH)
    await this.deriveKey(boundedPassword, DUMMY_SALT, this.currentParameters())
  }

  public async verify(password: string, verifier: string): Promise<boolean> {
    if (!this.isPasswordLengthValid(password)) {
      await this.performDummyVerification(password)
      return false
    }

    const parsed = this.parseVerifier(verifier)
    if (!parsed) {
      await this.performDummyVerification(password)
      return false
    }

    const candidate = await this.deriveKey(password, parsed.salt, parsed)
    return timingSafeEqual(candidate, parsed.derivedKey)
  }

  private currentParameters(): ScryptParameters {
    return { N: CURRENT_N, p: CURRENT_P, r: CURRENT_R }
  }

  private deriveKey(
    password: string,
    salt: Buffer,
    parameters: ScryptParameters,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        salt,
        DERIVED_KEY_BYTES,
        {
          maxmem: MAX_MEMORY_BYTES,
          N: parameters.N,
          p: parameters.p,
          r: parameters.r,
        },
        (error, derivedKey) => {
          if (error) {
            reject(error)
            return
          }
          resolve(derivedKey)
        },
      )
    })
  }

  private isPasswordLengthValid(password: string): boolean {
    return password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH
  }

  private isPowerOfTwo(value: number): boolean {
    return value > 0 && (value & (value - 1)) === 0
  }

  private parseVerifier(verifier: string): null | ParsedVerifier {
    const match = VERIFIER_PATTERN.exec(verifier)
    if (!match) {
      return null
    }

    const N = Number(match[1])
    const r = Number(match[2])
    const p = Number(match[3])
    if (
      !Number.isSafeInteger(N)
      || !this.isPowerOfTwo(N)
      || N < MIN_ACCEPTED_N
      || N > MAX_ACCEPTED_N
      || r !== CURRENT_R
      || p !== CURRENT_P
    ) {
      return null
    }

    try {
      const salt = Buffer.from(match[4], 'base64url')
      const derivedKey = Buffer.from(match[5], 'base64url')
      if (salt.length < SALT_BYTES || salt.length > 64 || derivedKey.length !== DERIVED_KEY_BYTES) {
        return null
      }
      return { derivedKey, N, p, r, salt }
    }
    catch {
      return null
    }
  }

  private validatePassword(password: string): void {
    if (!this.isPasswordLengthValid(password)) {
      throw new PartnerPortalPasswordValidationError(
        `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      )
    }
  }
}
