import 'reflect-metadata'
import { Webhook } from 'svix'

import { ResendWebhookSignatureError, ResendWebhookVerifier } from '../../../../modules/partners/infrastructure/ResendWebhookVerifier'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

const secret = `whsec_${Buffer.from('s'.repeat(32)).toString('base64')}`
const messageId = 'msg_111111111111111111111111'
const payload = Buffer.from(JSON.stringify({
  created_at: new Date().toISOString(),
  data: { email_id: 'resend-message-1' },
  type: 'email.delivered',
}))

const buildVerifier = (): ResendWebhookVerifier => {
  const secretManager: ISecretManager = {
    getSecret: jest.fn(async () => secret),
    getSecrets: jest.fn(),
  }
  return new ResendWebhookVerifier(secretManager)
}

describe('ResendWebhookVerifier', () => {
  it('verifies the exact raw payload and required Svix headers', async () => {
    const timestamp = new Date()
    const signature = new Webhook(secret).sign(messageId, timestamp, payload)

    await expect(buildVerifier().verify({
      messageId,
      rawBody: payload,
      signature,
      timestamp: String(Math.floor(timestamp.getTime() / 1_000)),
    })).resolves.toEqual(expect.objectContaining({ type: 'email.delivered' }))
  })

  it('rejects missing headers and body tampering with the same bounded error', async () => {
    const verifier = buildVerifier()
    await expect(verifier.verify({
      messageId: undefined,
      rawBody: payload,
      signature: undefined,
      timestamp: undefined,
    })).rejects.toBeInstanceOf(ResendWebhookSignatureError)

    const timestamp = new Date()
    const signature = new Webhook(secret).sign(messageId, timestamp, payload)
    await expect(verifier.verify({
      messageId,
      rawBody: Buffer.from(`${payload.toString('utf8')} `),
      signature,
      timestamp: String(Math.floor(timestamp.getTime() / 1_000)),
    })).rejects.toBeInstanceOf(ResendWebhookSignatureError)
  })
})
