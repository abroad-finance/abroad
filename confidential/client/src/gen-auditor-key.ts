import { writeFileSync } from 'node:fs'

import { H, pointToHex, randomFieldElement, scalarMul, toHex32 } from './protocol'

/** Generates an auditor Grumpkin keypair. Secret to file, public point to stdout. */
const secret = process.env.AUDITOR_SK ? BigInt(process.env.AUDITOR_SK) : randomFieldElement()
const point = scalarMul(secret, H)
writeFileSync('auditor.secret.json', `${JSON.stringify({
  publicKey: { x: `0x${toHex32(point.x)}`, y: `0x${toHex32(point.y)}` },
  secretKey: `0x${toHex32(secret)}`,
}, null, 2)}\n`, { mode: 0o600 })
console.error('auditor key written to auditor.secret.json (mode 0600)')
console.log(pointToHex(point))
