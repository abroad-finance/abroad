import { readFileSync, writeFileSync } from 'node:fs'

import { commit, Domain, poseidon2, toHex32 } from './protocol'

/**
 * Rebuilds a wallet's spendable opening from its viewing key and the salts of
 * the operations it has performed — the recovery property of DESIGN.md §5.2.
 */
const [secretFile, valueArg, ...salts] = process.argv.slice(2)
const secret = JSON.parse(readFileSync(secretFile, 'utf8')) as { spendingKey: string, addressField: string }
const viewingKey = poseidon2(Domain.VIEWING_KEY, [BigInt(secret.spendingKey), BigInt(secret.addressField)])

// The latest owner-initiated operation fixes the blinding; later deposits add zero.
const lastSalt = salts[salts.length - 1]
const randomness = poseidon2(Domain.SPEND_RANDOMNESS, [viewingKey, BigInt(lastSalt)])
const value = BigInt(valueArg)

writeFileSync('payer-state.json', `${JSON.stringify({ randomness: `0x${toHex32(randomness)}`, value: value.toString() }, null, 2)}\n`)
const c = commit(value, randomness)
console.log(`${toHex32(c.x)}${toHex32(c.y)}`)
