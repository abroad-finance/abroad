import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { addressToField, commit, Domain, ecdh, FIELD_MODULUS, H, poseidon2, scalarMul, toHex32 } from './protocol'

/**
 * Replays OpenZeppelin's cross-language conformance vectors against this client.
 *
 * A client that cannot reproduce these cannot construct a transfer the contract
 * will accept, so this runs before anything else touches the network.
 */

const TESTDATA = join(
  import.meta.dirname,
  '../../oz/packages/tokens/src/confidential/circuits/lib/testdata',
)

const load = (name: string): { vectors: Array<Record<string, unknown>> } =>
  JSON.parse(readFileSync(join(TESTDATA, `${name}.json`), 'utf8'))

let failures = 0

const check = (name: string, actual: string, expected: string): void => {
  const ok = actual.toLowerCase() === expected.toLowerCase().replace(/^0x/, '')
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        expected 0x${expected.replace(/^0x/, '')}\n        actual   0x${actual}`)
}

for (const vector of load('poseidon_with_domain').vectors) {
  const inputs = vector.inputs as { domain: string, inputs: string[] }
  check('poseidon_with_domain', toHex32(poseidon2(BigInt(inputs.domain), inputs.inputs.map(BigInt))), vector.output as string)
}

for (const vector of load('scalar_mul').vectors) {
  const point = scalarMul(BigInt((vector.inputs as { scalar: string }).scalar), H)
  const expected = vector.output as { x: string, y: string }
  check('scalar_mul.x', toHex32(point.x), expected.x)
  check('scalar_mul.y', toHex32(point.y), expected.y)
}

for (const vector of load('ecdh').vectors) {
  check('ecdh', toHex32(ecdh(BigInt((vector.inputs as { scalar: string }).scalar), H)), vector.output as string)
}

for (const vector of load('commit').vectors) {
  const inputs = vector.inputs as { randomness: string, value: string }
  const point = commit(BigInt(inputs.value), BigInt(inputs.randomness))
  const expected = vector.output as { x: string, y: string }
  check('commit.x', toHex32(point.x), expected.x)
  check('commit.y', toHex32(point.y), expected.y)
}

for (const vector of load('encrypt_amount').vectors) {
  const inputs = vector.inputs as { s: string, sigma: string, v_transfer: string }
  const encrypted = (BigInt(inputs.v_transfer) + poseidon2(Domain.TRANSFER_AMOUNT, [BigInt(inputs.s), BigInt(inputs.sigma)])) % FIELD_MODULUS
  check('encrypt_amount', toHex32(encrypted), vector.output as string)
}

for (const vector of load('derive_transfer_blind').vectors) {
  const inputs = vector.inputs as { s: string, sigma: string }
  check('derive_transfer_blind', toHex32(poseidon2(Domain.TRANSFER_BLINDING, [BigInt(inputs.s), BigInt(inputs.sigma)])), vector.output as string)
}

for (const vector of load('address_to_field').vectors) {
  const strkey = (vector.inputs as { strkey: string }).strkey
  check(`address_to_field(${strkey.slice(0, 1)}…)`, toHex32(addressToField(strkey)), vector.output as string)
}

console.log(failures === 0 ? '\nall vectors reproduced' : `\n${failures} vector(s) failed`)
process.exit(failures === 0 ? 0 : 1)
