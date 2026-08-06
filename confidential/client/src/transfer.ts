import { readFileSync } from 'node:fs'

import { encodeTransferData, prove } from './prove'
import {
  commit,
  deriveAccountKeys,
  deriveTransfer,
  Domain,
  ecdh,
  FIELD_MODULUS,
  poseidon2,
  randomFieldElement,
  spongeSqueeze2,
  toHex32,
  type Point,
} from './protocol'

/**
 * Builds a confidential transfer and prints the `data` blob for
 * `confidential_transfer(from, to, data)`.
 *
 * Usage:
 *   tsx src/transfer.ts <sender-secret.json> <state.json> <amount> <recipient-pvk.json> <auditor-pub.json>
 *
 * The sender must know its own current spendable opening `(v, r)` — the wallet
 * state a real client maintains by replaying events. It is passed in explicitly
 * here rather than reconstructed, because a demo client that silently guessed
 * its balance would hide exactly the failure mode a real wallet has to handle.
 */

const [senderFile, stateFile, amountArg, recipientFile, auditorFile] = process.argv.slice(2)
if (!senderFile || !stateFile || !amountArg || !recipientFile || !auditorFile) {
  console.error('usage: transfer.ts <sender-secret.json> <state.json> <amount> <recipient-pvk.json> <auditor-pub.json>')
  process.exit(2)
}

const readJson = (path: string): Record<string, string | Record<string, string>> =>
  JSON.parse(readFileSync(path, 'utf8'))
const readPoint = (value: unknown): Point => {
  const point = value as { x: string, y: string }
  return { x: BigInt(point.x), y: BigInt(point.y) }
}

const sender = readJson(senderFile)
const state = readJson(stateFile)
const recipient = readJson(recipientFile)
const auditor = readJson(auditorFile)

const addressField = BigInt(sender.addressField as string)
const keys = deriveAccountKeys(BigInt(sender.spendingKey as string), addressField)

const balance = BigInt(state.value as string)
const balanceBlinding = BigInt(state.randomness as string)
const amount = BigInt(amountArg)
if (amount > balance) {
  console.error(`cannot send ${amount} from a spendable balance of ${balance}`)
  process.exit(1)
}

const recipientViewingPublicKey = readPoint(recipient.viewingPublicKey)
const auditorKey = readPoint(auditor.publicKey)
const salt = randomFieldElement()

// Recipient channel: constraints T5–T9.
const transfer = deriveTransfer({
  amount,
  recipientViewingPublicKey,
  salt,
  senderViewingKey: keys.viewingKey,
})

// New sender balance with deterministic randomness: T10–T12.
const remaining = balance - amount
const newBlinding = poseidon2(Domain.SPEND_RANDOMNESS, [keys.viewingKey, salt])
const newCommitment = commit(remaining, newBlinding)
const encryptedBalance = (remaining + poseidon2(Domain.ENCRYPTED_BALANCE, [keys.viewingKey, salt])) % FIELD_MODULUS

// Both auditor channels reuse the ephemeral scalar: T_a1–T_a8. The same auditor
// key serves both sides here because both accounts registered under auditor 0.
const sharedAuditorRecipient = ecdh(transfer.ephemeralScalar, auditorKey)
const sharedAuditorSender = ecdh(transfer.ephemeralScalar, auditorKey)
const [maskAmountRecipient, maskRandomnessRecipient] = spongeSqueeze2(Domain.AUDITOR_RECIPIENT, sharedAuditorRecipient, salt)
const [maskAmountSender, maskBalanceSender] = spongeSqueeze2(Domain.AUDITOR_SENDER, sharedAuditorSender, salt)

const mod = (value: bigint): bigint => ((value % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS
const encryptedAmountAuditorRecipient = mod(amount + maskAmountRecipient)
const encryptedBlindingAuditorRecipient = mod(transfer.blinding + maskRandomnessRecipient)
const encryptedAmountAuditorSender = mod(amount + maskAmountSender)
const encryptedBalanceAuditorSender = mod(remaining + maskBalanceSender)

const spendCommitment = commit(balance, balanceBlinding)

const { proof } = prove('transfer', {
  addr_f: `0x${toHex32(addressField)}`,
  b_tilde: `0x${toHex32(encryptedBalance)}`,
  b_tilde_aud_s: `0x${toHex32(encryptedBalanceAuditorSender)}`,
  c_spend_new_x: `0x${toHex32(newCommitment.x)}`,
  c_spend_new_y: `0x${toHex32(newCommitment.y)}`,
  c_spend_x: `0x${toHex32(spendCommitment.x)}`,
  c_spend_y: `0x${toHex32(spendCommitment.y)}`,
  c_transfer_x: `0x${toHex32(transfer.commitment.x)}`,
  c_transfer_y: `0x${toHex32(transfer.commitment.y)}`,
  k_aud_r_x: `0x${toHex32(auditorKey.x)}`,
  k_aud_r_y: `0x${toHex32(auditorKey.y)}`,
  k_aud_s_x: `0x${toHex32(auditorKey.x)}`,
  k_aud_s_y: `0x${toHex32(auditorKey.y)}`,
  pvk_b_x: `0x${toHex32(recipientViewingPublicKey.x)}`,
  pvk_b_y: `0x${toHex32(recipientViewingPublicKey.y)}`,
  r: `0x${toHex32(balanceBlinding)}`,
  r_e: `0x${toHex32(transfer.ephemeralScalar)}`,
  r_e_x: `0x${toHex32(transfer.ephemeralPublicKey.x)}`,
  r_e_y: `0x${toHex32(transfer.ephemeralPublicKey.y)}`,
  r_tilde_aud_r: `0x${toHex32(encryptedBlindingAuditorRecipient)}`,
  sigma: `0x${toHex32(salt)}`,
  sk: `0x${toHex32(BigInt(sender.spendingKey as string))}`,
  v: `0x${toHex32(balance)}`,
  v_tilde: `0x${toHex32(transfer.encryptedAmount)}`,
  v_tilde_aud_r: `0x${toHex32(encryptedAmountAuditorRecipient)}`,
  v_tilde_aud_s: `0x${toHex32(encryptedAmountAuditorSender)}`,
  v_transfer: `0x${toHex32(amount)}`,
  y_x: `0x${toHex32(keys.spendingPublicKey.x)}`,
  y_y: `0x${toHex32(keys.spendingPublicKey.y)}`,
})

// The sender's next spend needs this opening; a real wallet persists it here.
console.error(`next spendable opening: value=${remaining} randomness=0x${toHex32(newBlinding)}`)

console.log(encodeTransferData({
  bTilde: encryptedBalance,
  bTildeAudS: encryptedBalanceAuditorSender,
  cSpendNew: newCommitment,
  cTransfer: transfer.commitment,
  proof,
  rEPoint: transfer.ephemeralPublicKey,
  rTildeAudR: encryptedBlindingAuditorRecipient,
  sigma: salt,
  vTilde: transfer.encryptedAmount,
  vTildeAudR: encryptedAmountAuditorRecipient,
  vTildeAudS: encryptedAmountAuditorSender,
}))
