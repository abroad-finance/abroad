import { inject, injectable } from 'inversify'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { TYPES } from '../../../app/container/types'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60
const SIGNATURE_PATTERN = /^HMAC-SHA256 t=(\d+),sig=([A-Za-z0-9+/]+={0,2})$/

export class TransferoUltraWebhookSignatureError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'TransferoUltraWebhookSignatureError'
  }
}

export function verifyTransferoUltraWebhookSignature(params: {
  endpointSecret: string
  nowMs: number
  rawBody: Buffer
  signatureHeader: string
}): void {
  const match = SIGNATURE_PATTERN.exec(params.signatureHeader)
  if (!match) {
    throw new TransferoUltraWebhookSignatureError('Malformed Transfero Ultra signature')
  }

  const timestampSeconds = Number(match[1])
  const nowSeconds = Math.floor(params.nowMs / 1_000)
  if (
    !Number.isSafeInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) > MAX_SIGNATURE_AGE_SECONDS
  ) {
    throw new TransferoUltraWebhookSignatureError('Expired Transfero Ultra signature')
  }

  const providedSignature = Buffer.from(match[2], 'base64')
  if (providedSignature.length !== 32) {
    throw new TransferoUltraWebhookSignatureError('Invalid Transfero Ultra signature')
  }

  const signingKey = createHash('sha256')
    .update(params.endpointSecret)
    .digest('hex')
  const expectedSignature = createHmac('sha256', signingKey)
    .update(`${timestampSeconds}.`)
    .update(params.rawBody)
    .digest()

  if (!timingSafeEqual(expectedSignature, providedSignature)) {
    throw new TransferoUltraWebhookSignatureError('Invalid Transfero Ultra signature')
  }
}

@injectable()
export class TransferoUltraWebhookVerifier {
  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
  ) {}

  public async verify(params: {
    rawBody: Buffer
    signatureHeader: string | undefined
  }): Promise<void> {
    if (!params.signatureHeader) {
      throw new TransferoUltraWebhookSignatureError('Missing Transfero Ultra signature')
    }

    const endpointSecret = await this.secretManager.getSecret(
      Secrets.TRANSFERO_ULTRA_WEBHOOK_SECRET,
    )
    verifyTransferoUltraWebhookSignature({
      endpointSecret,
      nowMs: Date.now(),
      rawBody: params.rawBody,
      signatureHeader: params.signatureHeader,
    })
  }
}
