import { createHash } from 'crypto'

import { buildIdempotencyKey } from '../../../platform/http/idempotencyKey'

/**
 * The three implementations that existed before the helper was extracted,
 * reproduced verbatim as oracles. These keys are part of Transfero Ultra's
 * duplicate-detection contract, so the extraction is only safe if the new
 * helper is byte-identical to what each call site produced before.
 */
const legacyPaymentKey = (operation: string, transactionId: string): string => {
  const candidate = `abroad:${operation}:${transactionId}`
  if (candidate.length <= 255) {
    return candidate
  }
  const digest = createHash('sha256').update(transactionId).digest('hex')
  return `abroad:${operation}:${digest}`
}

const legacyOtcKey = (operationId: string, phase: string): string => {
  const candidate = `abroad:otc:${operationId}:${phase}`
  if (candidate.length <= 255) {
    return candidate
  }
  return `abroad:otc:${createHash('sha256').update(operationId).digest('hex')}:${phase}`
}

const identifiers = [
  '',
  'a',
  '9f8c2c1e-4b3a-4d5e-8f7a-1c2b3d4e5f60',
  'x'.repeat(200),
  // Straddles the 255-char boundary from both sides for each prefix shape.
  'x'.repeat(235),
  'x'.repeat(236),
  'x'.repeat(237),
  'x'.repeat(238),
  'x'.repeat(239),
  'x'.repeat(240),
  'x'.repeat(241),
  'x'.repeat(242),
  'x'.repeat(243),
  'x'.repeat(244),
  'x'.repeat(245),
  'x'.repeat(246),
  'x'.repeat(500),
  'unicode-éção-中文',
]

const operations = ['pix-withdrawal', 'pix-preview', 'pix-deposit', 'pix-refund']
const phases = ['session', 'confirmation', 'settlement:0', 'settlement:999999']

describe('buildIdempotencyKey', () => {
  it('reproduces the payment/deposit key for every operation and identifier', () => {
    for (const operation of operations) {
      for (const identifier of identifiers) {
        expect(buildIdempotencyKey(['abroad', operation], identifier))
          .toBe(legacyPaymentKey(operation, identifier))
      }
    }
  })

  it('reproduces the OTC key for every phase and identifier', () => {
    for (const phase of phases) {
      for (const identifier of identifiers) {
        expect(buildIdempotencyKey(['abroad', 'otc'], identifier, [phase]))
          .toBe(legacyOtcKey(identifier, phase))
      }
    }
  })

  it('keeps the identifier literal while it fits', () => {
    expect(buildIdempotencyKey(['abroad', 'pix-withdrawal'], 'tx-1'))
      .toBe('abroad:pix-withdrawal:tx-1')
    expect(buildIdempotencyKey(['abroad', 'otc'], 'op-1', ['session']))
      .toBe('abroad:otc:op-1:session')
  })

  it('hashes only the identifier once the key would exceed 255 characters', () => {
    const identifier = 'y'.repeat(300)
    const digest = createHash('sha256').update(identifier).digest('hex')

    expect(buildIdempotencyKey(['abroad', 'pix-withdrawal'], identifier))
      .toBe(`abroad:pix-withdrawal:${digest}`)
    // The suffix must survive the collapse, otherwise every settlement retry
    // would reuse one key and the provider would treat them as replays.
    expect(buildIdempotencyKey(['abroad', 'otc'], identifier, ['settlement:7']))
      .toBe(`abroad:otc:${digest}:settlement:7`)
  })

  it('is deterministic and collision-free across distinct operations', () => {
    const identifier = 'z'.repeat(400)
    expect(buildIdempotencyKey(['abroad', 'pix-withdrawal'], identifier))
      .toBe(buildIdempotencyKey(['abroad', 'pix-withdrawal'], identifier))
    expect(buildIdempotencyKey(['abroad', 'pix-withdrawal'], identifier))
      .not.toBe(buildIdempotencyKey(['abroad', 'pix-refund'], identifier))
    expect(buildIdempotencyKey(['abroad', 'otc'], identifier, ['settlement:1']))
      .not.toBe(buildIdempotencyKey(['abroad', 'otc'], identifier, ['settlement:2']))
  })

  it('never exceeds the provider limit for a realistic identifier', () => {
    for (const identifier of identifiers) {
      const key = buildIdempotencyKey(['abroad', 'pix-withdrawal'], identifier)
      expect(key.length).toBeLessThanOrEqual(255)
    }
  })
})
