import { Field } from '@noble/curves/abstract/modular'
import { weierstrassPoints } from '@noble/curves/abstract/weierstrass'
import { poseidon2Hash } from '@zkpassport/poseidon2'

/**
 * Primitives of OpenZeppelin's confidential-token protocol for Soroban
 * (`stellar-contracts`, `packages/tokens/src/confidential`).
 *
 * Every export mirrors one primitive of that specification. Correctness is not
 * asserted against our own expectations: the test suite replays the upstream
 * cross-language conformance vectors (`circuits/lib/testdata/*.json`), which are
 * the protocol's own definition of a conformant off-chain implementation.
 *
 * Nothing here is secret-dependent except the ECDH scalar multiplication, which
 * consumes the viewing key; that path uses the constant-time multiply.
 */

/** Grumpkin base field, equal to the BN254 scalar field (DESIGN.md 2.2). */
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** Grumpkin group order, equal to the BN254 base field (DESIGN.md 2.2). */
const GROUP_ORDER = 21888242871839275222246405745257275088696311157297823662689037894645226208583n

/**
 * Poseidon2 domain separation tags (DESIGN_cont.md 13). The protocol fixes these
 * numeric values; only the tags this verifier evaluates are listed.
 */
export const ConfidentialDomain = Object.freeze({
  /** ECDH shared-secret scalar extraction, DESIGN.md 2.4. */
  ECDH_SHARED_SECRET: 13n,
  /** Transfer amount encryption, constraint T9. */
  TRANSFER_AMOUNT: 6n,
  /** ECDH-derived transfer blinding, constraint T7. */
  TRANSFER_BLINDING: 5n,
})

/** Values and balances are constrained to `[0, 2^127)` (DESIGN.md 2.6). */
export const MAX_CONFIDENTIAL_VALUE = 1n << 127n

/** An affine Grumpkin point. The protocol encodes the identity as `(0, 0)`. */
export type GrumpkinPoint = {
  x: bigint
  y: bigint
}

const baseField = Field(FIELD_MODULUS)

// Grumpkin: y^2 = x^3 - 17 over the BN254 scalar field. The generator given here
// is Barretenberg's Pedersen generator at index 0, which is the value generator G.
const { Point: CurvePoint } = weierstrassPoints({
  a: baseField.create(0n),
  b: baseField.create(-17n),
  Fp: baseField,
  Gx: 0x083e7911d835097629f0067531fc15cafd79a89beecb39903f69572c636f4a5an,
  Gy: 0x1a7f5efaad7f315c25a918f30cc8d7333fccab7ad7c90f14de81bcc528f9935dn,
  h: 1n,
  n: GROUP_ORDER,
})

/**
 * Barretenberg's Pedersen generators, `derive_generators("DEFAULT_DOMAIN_SEPARATOR")`
 * at indices 0 and 1 (DESIGN_cont.md 10.4). No known discrete-log relation.
 */
const GENERATOR_VALUE = CurvePoint.BASE
const GENERATOR_BLINDING = CurvePoint.fromAffine({
  x: 0x054aa86a73cb8a34525e5bbed6e43ba1198e860f5f3950268f71df4591bde402n,
  y: 0x209dcfbf2cfb57f9f6046f44d71ac6faf87254afc7407c04eb621a6287cac126n,
})

/**
 * Reads a canonical field element from a 32-byte big-endian representative.
 *
 * Non-canonical representatives (`x >= r`) are rejected rather than reduced. The
 * Soroban host silently reduces them (DESIGN.md 2.2, *Host deserialiser caveat*),
 * which would let two distinct byte strings denote the same logical value; the
 * contract enforces canonicality before verification, and so do we.
 */
export function decodeFieldElement(bytes: Buffer): bigint | null {
  if (bytes.length !== 32) {
    return null
  }
  const value = BigInt(`0x${bytes.toString('hex')}`)
  return value < FIELD_MODULUS ? value : null
}

/**
 * Reads an affine Grumpkin point from its two 32-byte coordinates, rejecting
 * non-canonical coordinates, off-curve points and the identity.
 *
 * The identity is rejected because every point this verifier reads is an
 * ephemeral key or a commitment that the protocol forbids from collapsing:
 * `r_e != 0` is constraint T13, and a transfer commitment at the identity would
 * carry no value.
 */
export function decodePoint(x: Buffer, y: Buffer): GrumpkinPoint | null {
  const decodedX = decodeFieldElement(x)
  const decodedY = decodeFieldElement(y)
  if (decodedX === null || decodedY === null) {
    return null
  }
  if (decodedX === 0n && decodedY === 0n) {
    return null
  }

  try {
    CurvePoint.fromAffine({ x: decodedX, y: decodedY }).assertValidity()
  }
  catch {
    return null
  }

  return { x: decodedX, y: decodedY }
}

/**
 * ECDH shared scalar `s = Poseidon2(delta_ecdh, S.x, S.y)` with `S = scalar * point`
 * (DESIGN.md 2.4). Both coordinates are absorbed so that `P` and `-P` do not
 * collapse onto one shared secret.
 */
export function ecdhSharedScalar(scalar: bigint, point: GrumpkinPoint): bigint {
  const shared = scalarMultiply(CurvePoint.fromAffine(point), scalar)
  return poseidon2WithDomain(ConfidentialDomain.ECDH_SHARED_SECRET, [shared.x, shared.y])
}

/** Pedersen commitment `value * G + randomness * H` on Grumpkin (DESIGN.md 2.3). */
export function pedersenCommit(value: bigint, randomness: bigint): GrumpkinPoint {
  const valueTerm = scalarMultiplyProjective(GENERATOR_VALUE, value)
  const blindingTerm = scalarMultiplyProjective(GENERATOR_BLINDING, randomness)
  return valueTerm.add(blindingTerm).toAffine()
}

/** True when the two points are the same affine point. */
export function pointsEqual(left: GrumpkinPoint, right: GrumpkinPoint): boolean {
  return left.x === right.x && left.y === right.y
}

/**
 * The Poseidon2 sponge this protocol uses everywhere: Barretenberg's BN254
 * instantiation at width 4, rate 3, capacity 1, with the domain tag as the first
 * absorbed element (DESIGN.md 2.5).
 */
export function poseidon2WithDomain(domain: bigint, inputs: bigint[]): bigint {
  return poseidon2Hash([domain, ...inputs])
}

/** Subtraction in the base field, used to strip a one-time pad from a ciphertext. */
export function subtractFieldElements(left: bigint, right: bigint): bigint {
  return (left - right + FIELD_MODULUS) % FIELD_MODULUS
}

function scalarMultiply(point: ReturnType<typeof CurvePoint.fromAffine>, scalar: bigint): GrumpkinPoint {
  return scalarMultiplyProjective(point, scalar).toAffine()
}

function scalarMultiplyProjective(
  point: ReturnType<typeof CurvePoint.fromAffine>,
  scalar: bigint,
): ReturnType<typeof CurvePoint.fromAffine> {
  // `multiply` is the constant-time ladder but rejects a zero scalar, which is a
  // legal input here (a zero-valued commitment term). Only that case degrades.
  return scalar === 0n ? CurvePoint.ZERO : point.multiply(scalar)
}
