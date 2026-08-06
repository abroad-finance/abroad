import { parseViewingKey, recoverDisclosedAmount } from '../../../../../modules/payments/infrastructure/wallets/confidentialDisclosure'
import { pedersenCommit } from '../../../../../modules/payments/infrastructure/wallets/confidentialGrumpkin'
import { buildConfidentialTransfer } from './confidentialTestUtils'

const VIEWING_KEY = 0x0f1e2d3c4b5a69788796a5b4c3d2e1f0n
const AMOUNT = 12_345_678n

describe('recoverDisclosedAmount', () => {
  const transfer = buildConfidentialTransfer({ amount: AMOUNT, viewingKey: VIEWING_KEY })
  const input = { ...transfer, viewingKey: VIEWING_KEY }

  it('recovers the amount the sender committed to', () => {
    expect(recoverDisclosedAmount(input)).toEqual({ amount: AMOUNT, outcome: 'ok' })
  })

  it('recovers a zero amount without treating it as a failure', () => {
    const zeroTransfer = buildConfidentialTransfer({ amount: 0n, viewingKey: VIEWING_KEY })

    expect(recoverDisclosedAmount({ ...zeroTransfer, viewingKey: VIEWING_KEY }))
      .toEqual({ amount: 0n, outcome: 'ok' })
  })

  it('rejects a different viewing key', () => {
    // A wrong key decrypts to a different value, which then fails to recommit.
    expect(recoverDisclosedAmount({ ...input, viewingKey: VIEWING_KEY + 1n }).outcome).toBe('rejected')
  })

  it('rejects a tampered ciphertext', () => {
    // The classic path would simply believe a rewritten amount. Here the
    // recovered value stops matching the commitment the contract credited.
    expect(recoverDisclosedAmount({ ...input, encryptedAmount: input.encryptedAmount + 1n }))
      .toEqual({ outcome: 'rejected', reason: 'commitment_mismatch' })
  })

  it('rejects a commitment that belongs to a different amount', () => {
    const other = buildConfidentialTransfer({ amount: AMOUNT + 1n, viewingKey: VIEWING_KEY })

    expect(recoverDisclosedAmount({ ...input, transferCommitment: other.transferCommitment }))
      .toEqual({ outcome: 'rejected', reason: 'commitment_mismatch' })
  })

  it('rejects a tampered salt', () => {
    expect(recoverDisclosedAmount({ ...input, salt: input.salt + 1n }).outcome).toBe('rejected')
  })

  it('rejects a tampered ephemeral public key', () => {
    expect(recoverDisclosedAmount({ ...input, ephemeralPublicKey: pedersenCommit(0n, 999n) }).outcome)
      .toBe('rejected')
  })

  it('rejects an amount outside the protocol range before recommitting', () => {
    const overflowing = buildConfidentialTransfer({ amount: 1n << 200n, viewingKey: VIEWING_KEY })

    expect(recoverDisclosedAmount({ ...overflowing, viewingKey: VIEWING_KEY }))
      .toEqual({ outcome: 'rejected', reason: 'amount_out_of_range' })
  })

  it('is deterministic, so a replayed transfer yields the same amount', () => {
    expect(recoverDisclosedAmount(input)).toEqual(recoverDisclosedAmount(input))
  })
})

describe('parseViewingKey', () => {
  const key = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0'

  it('accepts a canonical 32-byte hex key', () => {
    expect(parseViewingKey(key)).toBe(BigInt(`0x${key}`))
  })

  it('accepts a 0x prefix and surrounding whitespace', () => {
    expect(parseViewingKey(`  0x${key}\n`)).toBe(BigInt(`0x${key}`))
  })

  it.each([
    ['the wrong length', 'abcd'],
    ['non-hex characters', 'z'.repeat(64)],
    ['an empty value', ''],
    ['zero, which collapses every shared secret', '0'.repeat(64)],
    ['a non-canonical representative', 'f'.repeat(64)],
  ])('rejects %s', (_case, value) => {
    expect(parseViewingKey(value)).toBeNull()
  })
})
