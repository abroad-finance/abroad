import 'reflect-metadata'
import { createHash, createHmac } from 'node:crypto'

import { TransferoUltraWebhookSignatureError, verifyTransferoUltraWebhookSignature } from '../../../../modules/transfero/infrastructure/TransferoUltraWebhookVerifier'

const ENDPOINT_SECRET = 'endpoint-secret'
const NOW_MS = Date.parse('2026-07-27T12:34:56.000Z')
const TIMESTAMP_SECONDS = Math.floor(NOW_MS / 1_000)
const RAW_BODY = Buffer.from('{"eventId":"11111111-2222-4333-8444-555555555555"}')

const sign = (rawBody: Buffer, timestampSeconds = TIMESTAMP_SECONDS): string => {
  const signingKey = createHash('sha256').update(ENDPOINT_SECRET).digest('hex')
  const signature = createHmac('sha256', signingKey)
    .update(`${timestampSeconds}.`)
    .update(rawBody)
    .digest('base64')
  return `HMAC-SHA256 t=${timestampSeconds},sig=${signature}`
}

describe('verifyTransferoUltraWebhookSignature', () => {
  it('accepts the exact raw-body Ultra signature within the replay window', () => {
    expect(() => verifyTransferoUltraWebhookSignature({
      endpointSecret: ENDPOINT_SECRET,
      nowMs: NOW_MS,
      rawBody: RAW_BODY,
      signatureHeader: sign(RAW_BODY),
    })).not.toThrow()
  })

  it('rejects body tampering even when parsed JSON would be equivalent', () => {
    const reformatted = Buffer.from('{ "eventId": "11111111-2222-4333-8444-555555555555" }')

    expect(() => verifyTransferoUltraWebhookSignature({
      endpointSecret: ENDPOINT_SECRET,
      nowMs: NOW_MS,
      rawBody: reformatted,
      signatureHeader: sign(RAW_BODY),
    })).toThrow('Invalid Transfero Ultra signature')
  })

  it.each([
    TIMESTAMP_SECONDS - 301,
    TIMESTAMP_SECONDS + 301,
  ])('rejects timestamp %s outside the five-minute replay window', (timestampSeconds) => {
    expect(() => verifyTransferoUltraWebhookSignature({
      endpointSecret: ENDPOINT_SECRET,
      nowMs: NOW_MS,
      rawBody: RAW_BODY,
      signatureHeader: sign(RAW_BODY, timestampSeconds),
    })).toThrow('Expired Transfero Ultra signature')
  })

  it.each([
    '',
    `t=${TIMESTAMP_SECONDS},sig=invalid`,
    `HMAC-SHA256 t=${TIMESTAMP_SECONDS},sig=YWJjZA==`,
  ])('rejects malformed or invalid-length signature %j', (signatureHeader) => {
    expect(() => verifyTransferoUltraWebhookSignature({
      endpointSecret: ENDPOINT_SECRET,
      nowMs: NOW_MS,
      rawBody: RAW_BODY,
      signatureHeader,
    })).toThrow(TransferoUltraWebhookSignatureError)
  })
})
