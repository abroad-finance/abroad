import { writeFileSync } from 'node:fs'

import { encodeRegisterData, prove } from './prove'
import { addressToField, deriveAccountKeys, randomFieldElement, toHex32 } from './protocol'

/**
 * Registers a confidential account and prints the `data` blob for
 * `register(account, auditor_id, data)`.
 *
 * Usage: tsx src/register.ts <token-contract> <account-address> [out-file]
 *
 * A fresh spending key is generated unless `SPENDING_KEY` is set. The key and
 * the derived viewing key are written to the out-file, never to stdout — the
 * viewing key is what reads every incoming amount for the life of the account.
 */

const [tokenContract, accountAddress, outFile = 'account.secret.json'] = process.argv.slice(2)
if (!tokenContract || !accountAddress) {
  console.error('usage: register.ts <token-contract> <account-address> [out-file]')
  process.exit(2)
}

const addressField = addressToField(tokenContract)
const accountField = addressToField(accountAddress)
const spendingKey = process.env.SPENDING_KEY ? BigInt(process.env.SPENDING_KEY) : randomFieldElement()
const keys = deriveAccountKeys(spendingKey, addressField)

const { proof } = prove('register', {
  _acct_f: `0x${toHex32(accountField)}`,
  addr_f: `0x${toHex32(addressField)}`,
  pvk_x: `0x${toHex32(keys.viewingPublicKey.x)}`,
  pvk_y: `0x${toHex32(keys.viewingPublicKey.y)}`,
  sk: `0x${toHex32(spendingKey)}`,
  y_x: `0x${toHex32(keys.spendingPublicKey.x)}`,
  y_y: `0x${toHex32(keys.spendingPublicKey.y)}`,
})

writeFileSync(outFile, `${JSON.stringify({
  account: accountAddress,
  addressField: `0x${toHex32(addressField)}`,
  spendingKey: `0x${toHex32(spendingKey)}`,
  token: tokenContract,
  viewingKey: `0x${toHex32(keys.viewingKey)}`,
  viewingPublicKey: { x: `0x${toHex32(keys.viewingPublicKey.x)}`, y: `0x${toHex32(keys.viewingPublicKey.y)}` },
}, null, 2)}\n`, { mode: 0o600 })

console.error(`keys written to ${outFile} (mode 0600) — treat as secret`)
console.log(encodeRegisterData({ proof, pvk: keys.viewingPublicKey, y: keys.spendingPublicKey }))
