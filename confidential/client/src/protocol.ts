import { Field } from '@noble/curves/abstract/modular'
import { weierstrassPoints } from '@noble/curves/abstract/weierstrass'
import { permute, poseidon2Hash } from '@zkpassport/poseidon2'

/**
 * Client-side primitives of OpenZeppelin's confidential-token protocol.
 *
 * This is the sender/holder half of what `abroad-server` already does as
 * recipient. Everything here is pinned by the upstream conformance vectors in
 * `circuits/lib/testdata/`; `verify-vectors.ts` replays them.
 */

export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const GROUP_ORDER = 21888242871839275222246405745257275088696311157297823662689037894645226208583n

/** Poseidon2 domain tags, DESIGN_cont.md §13. Hardcoded values are normative. */
export const Domain = {
  ADDRESS: 1n,
  VIEWING_KEY: 2n,
  SPEND_RANDOMNESS: 4n,
  TRANSFER_BLINDING: 5n,
  TRANSFER_AMOUNT: 6n,
  ENCRYPTED_BALANCE: 7n,
  AUDITOR_SENDER: 11n,
  AUDITOR_RECIPIENT: 12n,
  ECDH_SHARED_SECRET: 13n,
  EPHEMERAL: 14n,
} as const

export type Point = { x: bigint, y: bigint }

const baseField = Field(FIELD_MODULUS)

const { Point: CurvePoint } = weierstrassPoints({
  a: baseField.create(0n),
  b: baseField.create(-17n),
  Fp: baseField,
  Gx: 0x083e7911d835097629f0067531fc15cafd79a89beecb39903f69572c636f4a5an,
  Gy: 0x1a7f5efaad7f315c25a918f30cc8d7333fccab7ad7c90f14de81bcc528f9935dn,
  h: 1n,
  n: GROUP_ORDER,
})

export const G: Point = CurvePoint.BASE.toAffine()
export const H: Point = CurvePoint.fromAffine({
  x: 0x054aa86a73cb8a34525e5bbed6e43ba1198e860f5f3950268f71df4591bde402n,
  y: 0x209dcfbf2cfb57f9f6046f44d71ac6faf87254afc7407c04eb621a6287cac126n,
}).toAffine()

export function poseidon2(domain: bigint, inputs: bigint[]): bigint {
  return poseidon2Hash([domain, ...inputs])
}

export function scalarMul(scalar: bigint, point: Point): Point {
  if (scalar === 0n) throw new Error('zero scalar has no affine representation here')
  return CurvePoint.fromAffine(point).multiply(scalar).toAffine()
}

export function addPoints(left: Point, right: Point): Point {
  return CurvePoint.fromAffine(left).add(CurvePoint.fromAffine(right)).toAffine()
}

/** Pedersen commitment `value * G + randomness * H` (DESIGN.md §2.3). */
export function commit(value: bigint, randomness: bigint): Point {
  const valueTerm = value === 0n ? CurvePoint.ZERO : CurvePoint.BASE.multiply(value)
  const blindingTerm = randomness === 0n ? CurvePoint.ZERO : CurvePoint.fromAffine(H).multiply(randomness)
  return valueTerm.add(blindingTerm).toAffine()
}

/** ECDH shared scalar `Poseidon2(δ_ecdh, S.x, S.y)` with `S = scalar * point`. */
export function ecdh(scalar: bigint, point: Point): bigint {
  const shared = scalarMul(scalar, point)
  return poseidon2(Domain.ECDH_SHARED_SECRET, [shared.x, shared.y])
}

/**
 * Compresses a Soroban address into one field element (DESIGN.md §2.7).
 *
 * The input is the 56-character ASCII strkey; the two 28-byte halves are read
 * **little-endian**. This is the one primitive with two independent
 * implementations — contract and client — so it is the one most worth pinning.
 */
export function addressToField(strkey: string): bigint {
  const ascii = Buffer.from(strkey, 'ascii')
  if (ascii.length !== 56) {
    throw new Error(`expected a 56-character strkey, got ${ascii.length}`)
  }
  const limb = (start: number): bigint => {
    let value = 0n
    for (let i = 27; i >= 0; i -= 1) {
      value = (value << 8n) | BigInt(ascii[start + i])
    }
    return value
  }
  return poseidon2(Domain.ADDRESS, [limb(0), limb(28)])
}

/** Viewing key `vk = Poseidon2(δ_vk, sk, addr_f)` (DESIGN.md §4.2). */
export function viewingKeyFromSpendingKey(spendingKey: bigint, addressField: bigint): bigint {
  return poseidon2(Domain.VIEWING_KEY, [spendingKey, addressField])
}

/** The full key hierarchy an account registers with (DESIGN.md §4). */
export function deriveAccountKeys(spendingKey: bigint, addressField: bigint) {
  const viewingKey = viewingKeyFromSpendingKey(spendingKey, addressField)
  if (viewingKey === 0n) {
    throw new Error('degenerate viewing key; choose another spending key')
  }
  return {
    spendingKey,
    spendingPublicKey: scalarMul(spendingKey, H),
    viewingKey,
    viewingPublicKey: scalarMul(viewingKey, H),
  }
}

/**
 * The sender side of a confidential transfer (DESIGN.md §5.3, constraints T5–T9).
 *
 * The ephemeral scalar is *derived*, not sampled: `r_e = Poseidon2(δ_eph, vk, σ)`.
 * That is what lets a sender reconstruct any past transfer's opening from the
 * event alone, and it means salt freshness carries the entire uniqueness
 * requirement — reusing σ reuses every one-time pad in the transfer.
 */
export function deriveTransfer(params: {
  amount: bigint
  recipientViewingPublicKey: Point
  salt: bigint
  senderViewingKey: bigint
}) {
  const ephemeralScalar = poseidon2(Domain.EPHEMERAL, [params.senderViewingKey, params.salt])
  if (ephemeralScalar === 0n) {
    throw new Error('degenerate ephemeral scalar; retry with a fresh salt')
  }

  const ephemeralPublicKey = scalarMul(ephemeralScalar, H)
  const shared = ecdh(ephemeralScalar, params.recipientViewingPublicKey)
  const blinding = poseidon2(Domain.TRANSFER_BLINDING, [shared, params.salt])
  const encryptedAmount = (params.amount + poseidon2(Domain.TRANSFER_AMOUNT, [shared, params.salt])) % FIELD_MODULUS

  return {
    blinding,
    commitment: commit(params.amount, blinding),
    encryptedAmount,
    ephemeralPublicKey,
    ephemeralScalar,
    shared,
  }
}

/** Two masks from one absorb, for the auditor channels (DESIGN.md §2.5). */
export function spongeSqueeze2(domain: bigint, shared: bigint, salt: bigint): [bigint, bigint] {
  // Lane 0 is always the amount mask, lane 1 the balance/randomness mask.
  // `poseidon2Hash` exposes only lane 0, so the second lane is taken from the
  // permutation directly.
  const state = permuteState([domain, shared, salt, 3n * (1n << 64n)])
  return [state[0], state[1]]
}

export function toHex32(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

export function pointToHex(point: Point): string {
  return toHex32(point.x) + toHex32(point.y)
}

export function randomFieldElement(): bigint {
  // Rejection sampling into F_r (DESIGN.md §2.2): mask the top two bits, retry
  // on a draw at or above the modulus, and never return zero.
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    bytes[0] &= 0x3f
    let value = 0n
    for (const byte of bytes) value = (value << 8n) | BigInt(byte)
    if (value !== 0n && value < FIELD_MODULUS) return value
  }
}

function permuteState(state: bigint[]): bigint[] {
  return permute(state)
}
