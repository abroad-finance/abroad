import { inject, injectable } from 'inversify'
import { Webhook } from 'svix'

import { TYPES } from '../../../app/container/types'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'

const MINIMUM_WEBHOOK_SECRET_LENGTH = 24

export class ResendWebhookSignatureError extends Error {
  public constructor() {
    super('Invalid Resend webhook signature')
    this.name = 'ResendWebhookSignatureError'
  }
}

@injectable()
export class ResendWebhookVerifier {
  public constructor(
    @inject(TYPES.ISecretManager)
    private readonly secretManager: ISecretManager,
  ) {}

  public async verify(input: {
    messageId: string | undefined
    rawBody: Buffer
    signature: string | undefined
    timestamp: string | undefined
  }): Promise<unknown> {
    if (!input.messageId || !input.signature || !input.timestamp) {
      throw new ResendWebhookSignatureError()
    }
    try {
      const secret = (await this.secretManager.getSecret(Secrets.RESEND_WEBHOOK_SECRET)).trim()
      if (secret.length < MINIMUM_WEBHOOK_SECRET_LENGTH) {
        throw new Error('Webhook secret is invalid')
      }
      return new Webhook(secret).verify(input.rawBody, {
        'svix-id': input.messageId,
        'svix-signature': input.signature,
        'svix-timestamp': input.timestamp,
      })
    }
    catch {
      throw new ResendWebhookSignatureError()
    }
  }
}
