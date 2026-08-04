import { describe, expect, it } from 'vitest'

import { classifyWalletConnectionFailure } from '../features/swap/model/walletConnection'

describe('wallet connection failure classification', () => {
  const cases = [
    { error: Object.assign(new Error('Rejected'), { code: 4001 }), expected: 'rejected' },
    { error: Object.assign(new Error('Unknown chain'), { code: 4902 }), expected: 'unsupported-network' },
    { error: new Error('Unsupported wallet'), expected: 'unsupported-wallet' },
    { error: new Error('Connection timed out'), expected: 'timeout' },
    { error: Object.assign(new Error('Disconnected'), { code: 4900 }), expected: 'disconnected' },
    { error: new Error('Network fetch failed'), expected: 'network' },
    { error: new Error('Unexpected provider response'), expected: 'unknown' },
  ] as const

  cases.forEach(({ error, expected }) => {
    it(`maps failures to ${expected} without exposing provider text`, () => {
      expect(classifyWalletConnectionFailure(error).code).toBe(expected)
    })
  })
})
