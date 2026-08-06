import {
  ConfidentialDomain,
  decodeFieldElement,
  decodePoint,
  ecdhSharedScalar,
  pedersenCommit,
  poseidon2WithDomain,
  subtractFieldElements,
} from '../../../../../modules/payments/infrastructure/wallets/confidentialGrumpkin'
import commitVectors from '../../../../fixtures/confidential/commit.json'
import deriveTransferBlindVectors from '../../../../fixtures/confidential/derive_transfer_blind.json'
import ecdhVectors from '../../../../fixtures/confidential/ecdh.json'
import encryptAmountVectors from '../../../../fixtures/confidential/encrypt_amount.json'
import poseidonVectors from '../../../../fixtures/confidential/poseidon_with_domain.json'
import scalarMulVectors from '../../../../fixtures/confidential/scalar_mul.json'

/**
 * These are OpenZeppelin's own cross-language conformance vectors, not ours.
 * Passing them is the protocol's definition of a correct off-chain implementation;
 * failing any one of them means an amount recovered from a real transfer would be
 * wrong, so nothing downstream is worth testing until they hold.
 */

const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** `H`, the blinding generator, reachable as `Com(0, 1) = 0 * G + 1 * H`. */
const GENERATOR_H = pedersenCommit(0n, 1n)

const hex = (value: bigint): string => `0x${value.toString(16).padStart(64, '0')}`
const toBytes = (value: bigint): Buffer => Buffer.from(value.toString(16).padStart(64, '0'), 'hex')

describe('confidentialGrumpkin conformance vectors', () => {
  it('reproduces poseidon_with_domain', () => {
    const [vector] = poseidonVectors.vectors
    const inputs = vector.inputs.inputs.map(input => BigInt(input))

    expect(hex(poseidon2WithDomain(BigInt(vector.inputs.domain), inputs))).toBe(vector.output)
  })

  it('reproduces scalar_mul against the H generator', () => {
    const [vector] = scalarMulVectors.vectors
    // `Com(0, k) = k * H`, which is exactly the vector's `scalar * H`.
    const product = pedersenCommit(0n, BigInt(vector.inputs.scalar))

    expect(hex(product.x)).toBe(vector.output.x)
    expect(hex(product.y)).toBe(vector.output.y)
  })

  it('reproduces ecdh', () => {
    const [vector] = ecdhVectors.vectors

    expect(hex(ecdhSharedScalar(BigInt(vector.inputs.scalar), GENERATOR_H))).toBe(vector.output)
  })

  it('reproduces commit', () => {
    const [vector] = commitVectors.vectors
    const commitment = pedersenCommit(BigInt(vector.inputs.value), BigInt(vector.inputs.randomness))

    expect(hex(commitment.x)).toBe(vector.output.x)
    expect(hex(commitment.y)).toBe(vector.output.y)
  })

  it('reproduces encrypt_amount', () => {
    const [vector] = encryptAmountVectors.vectors
    const mask = poseidon2WithDomain(ConfidentialDomain.TRANSFER_AMOUNT, [
      BigInt(vector.inputs.s),
      BigInt(vector.inputs.sigma),
    ])
    const encrypted = (BigInt(vector.inputs.v_transfer) + mask) % FIELD_MODULUS

    expect(hex(encrypted)).toBe(vector.output)
    // Decryption is the inverse the verifier actually runs.
    expect(subtractFieldElements(encrypted, mask)).toBe(BigInt(vector.inputs.v_transfer))
  })

  it('reproduces derive_transfer_blind', () => {
    const [vector] = deriveTransferBlindVectors.vectors
    const blinding = poseidon2WithDomain(ConfidentialDomain.TRANSFER_BLINDING, [
      BigInt(vector.inputs.s),
      BigInt(vector.inputs.sigma),
    ])

    expect(hex(blinding)).toBe(vector.output)
  })
})

describe('confidentialGrumpkin decoding', () => {
  it('accepts a canonical field element', () => {
    expect(decodeFieldElement(toBytes(42n))).toBe(42n)
  })

  it('rejects a non-canonical representative rather than reducing it', () => {
    // The Soroban host would silently reduce this to 1; two byte strings must
    // never denote the same logical value here.
    expect(decodeFieldElement(toBytes(FIELD_MODULUS + 1n))).toBeNull()
  })

  it('rejects a field element of the wrong width', () => {
    expect(decodeFieldElement(Buffer.alloc(31))).toBeNull()
  })

  it('decodes a point that is on the curve', () => {
    const point = pedersenCommit(7n, 9n)

    expect(decodePoint(toBytes(point.x), toBytes(point.y))).toEqual(point)
  })

  it('rejects a point that is not on the curve', () => {
    const point = pedersenCommit(7n, 9n)

    expect(decodePoint(toBytes(point.x), toBytes(point.y + 1n))).toBeNull()
  })

  it('rejects the identity encoding', () => {
    expect(decodePoint(toBytes(0n), toBytes(0n))).toBeNull()
  })
})

describe('ecdhSharedScalar', () => {
  it('is commutative, so sender and recipient derive the same secret', () => {
    const viewingKey = 0x1234567890abcdefn
    const ephemeralScalar = 0xfeedfacen
    const publicViewingKey = pedersenCommit(0n, viewingKey)
    const ephemeralPublicKey = pedersenCommit(0n, ephemeralScalar)

    expect(ecdhSharedScalar(viewingKey, ephemeralPublicKey))
      .toBe(ecdhSharedScalar(ephemeralScalar, publicViewingKey))
  })

  it('separates a key from its negation', () => {
    const point = pedersenCommit(0n, 5n)
    const negated = { x: point.x, y: FIELD_MODULUS - point.y }

    expect(ecdhSharedScalar(3n, point)).not.toBe(ecdhSharedScalar(3n, negated))
  })
})
