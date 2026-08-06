import {
  ConfidentialDomain,
  decodeFieldElement,
  ecdhSharedScalar,
  GrumpkinPoint,
  MAX_CONFIDENTIAL_VALUE,
  pedersenCommit,
  pointsEqual,
  poseidon2WithDomain,
  subtractFieldElements,
} from './confidentialGrumpkin'

/**
 * Recipient-side disclosure of a confidential transfer amount.
 *
 * The sender publishes an ephemeral public key `R_e`, a salt `sigma` and a
 * ciphertext `v_tilde` in the `Transfer` event, and supplies the Pedersen
 * commitment `C_transfer` in the call payload. The recipient recovers the amount
 * by ECDH against its viewing key.
 *
 * Recovery alone would only be as trustworthy as the sender's encryption, so it
 * is not what gates a payout. What gates it is the second step: the same shared
 * scalar re-derives the blinding factor, the pair is recommitted, and the result
 * must equal the on-chain `C_transfer` byte for byte. Pedersen binding then makes
 * the amount the *only* value that transfer could have moved — no second opening
 * exists without solving discrete log on Grumpkin. Constraints T7, T8 and T9,
 * which the contract verified on chain before accepting the transaction, are what
 * tie that commitment to the value credited to the recipient's balance.
 *
 * This is a strictly stronger proof than the classic Stellar path, which accepts
 * the plaintext amount Horizon reports for a payment operation.
 */

type ConfidentialDisclosureFailure
  = | 'amount_out_of_range'
    | 'commitment_mismatch'

type ConfidentialDisclosureInput = {
  /** `v_tilde`, the encrypted amount carried by the event. */
  encryptedAmount: bigint
  /** `R_e`, the transfer's ephemeral public key. */
  ephemeralPublicKey: GrumpkinPoint
  /** `sigma`, the per-operation salt carried by the event. */
  salt: bigint
  /** `C_transfer`, the commitment the contract added to our receiving balance. */
  transferCommitment: GrumpkinPoint
  /** Our account's viewing key. Never logged, never returned. */
  viewingKey: bigint
}

type ConfidentialDisclosureOutcome
  = | { amount: bigint, outcome: 'ok' }
    | { outcome: 'rejected', reason: ConfidentialDisclosureFailure }

/**
 * Parses a viewing key from its 32-byte big-endian hex representation.
 *
 * Returns `null` for anything that is not a canonical non-zero scalar; a zero key
 * would make every ECDH shared secret the identity.
 */
export function parseViewingKey(hex: string): bigint | null {
  const normalized = hex.trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]{64}$/i.test(normalized)) {
    return null
  }

  const key = decodeFieldElement(Buffer.from(normalized, 'hex'))
  if (key === null || key === 0n) {
    return null
  }

  return key
}

/**
 * Recovers the disclosed amount and proves it against the on-chain commitment.
 *
 * Returns the amount in the underlying token's minor units, or the reason the
 * disclosure could not be trusted. It never throws on adversarial input and never
 * reveals which intermediate value disagreed.
 */
export function recoverDisclosedAmount(input: ConfidentialDisclosureInput): ConfidentialDisclosureOutcome {
  const shared = ecdhSharedScalar(input.viewingKey, input.ephemeralPublicKey)

  const amountMask = poseidon2WithDomain(ConfidentialDomain.TRANSFER_AMOUNT, [shared, input.salt])
  const amount = subtractFieldElements(input.encryptedAmount, amountMask)
  if (amount >= MAX_CONFIDENTIAL_VALUE) {
    return { outcome: 'rejected', reason: 'amount_out_of_range' }
  }

  const blinding = poseidon2WithDomain(ConfidentialDomain.TRANSFER_BLINDING, [shared, input.salt])
  if (!pointsEqual(pedersenCommit(amount, blinding), input.transferCommitment)) {
    return { outcome: 'rejected', reason: 'commitment_mismatch' }
  }

  return { amount, outcome: 'ok' }
}
