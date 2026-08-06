import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'

import {
  ConfidentialDomain,
  ecdhSharedScalar,
  GrumpkinPoint,
  pedersenCommit,
  poseidon2WithDomain,
} from '../../../../../modules/payments/infrastructure/wallets/confidentialGrumpkin'

/**
 * Builders for confidential transfers that are cryptographically real.
 *
 * Nothing here is a stub: the transfer is derived exactly as a sender's wallet
 * would derive it (DESIGN.md 5.3 / constraints T5–T9), and the envelope is a real
 * Soroban invocation carrying a real XDR `TransferData` payload. The verifier
 * under test therefore does the same work it would do against a live ledger. What
 * is *not* reproduced is the UltraHonk proof — it can only be checked by the
 * contract, on chain, which is why the verifier reads a transaction that already
 * succeeded rather than re-verifying a proof off chain.
 */

const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const DEFAULT_REFERENCE = '3f2b1a90-8c4d-4e21-9b77-5a1c2d3e4f50'

export type ConfidentialTransferFixture = {
  encryptedAmount: bigint
  ephemeralPublicKey: GrumpkinPoint
  salt: bigint
  transferCommitment: GrumpkinPoint
}

export type TransferEnvelopeOptions = {
  /** Replaces `c_transfer` verbatim, to exercise a malformed point. */
  commitmentOverride?: Buffer
  /** The deposit wrapper the invocation targets. */
  contractAddress: string
  feeBump?: boolean
  functionName?: string
  recipient: string
  /** Abroad transaction UUID, or `null` to omit the reference argument. */
  reference?: null | string
  /** Replaces the reference argument verbatim, to exercise a malformed one. */
  referenceOverride?: Buffer
  sender: string
  transfer: ConfidentialTransferFixture
}

/** A deterministic contract strkey, so fixtures read the same on every run. */
export const testContractAddress = (seed = 1): string =>
  StrKey.encodeContract(Buffer.alloc(32, seed))

export const testAccountAddress = (): string => Keypair.random().publicKey()

/** The reference the wrapper carries: the transaction UUID's 16 bytes. */
export const referenceBytes = (transactionId: string): Buffer =>
  Buffer.from(transactionId.replace(/-/g, ''), 'hex')

/**
 * Derives a transfer the way a sender's wallet does.
 *
 * The sender side computes the shared scalar as `ECDH(r_e, PVK_B)`; the verifier
 * recomputes it as `ECDH(vk_B, R_e)`. They are computed from different arguments
 * here on purpose, so the fixture is not merely a mirror of the code under test.
 */
export function buildConfidentialTransfer(params: {
  amount: bigint
  ephemeralScalar?: bigint
  salt?: bigint
  viewingKey: bigint
}): ConfidentialTransferFixture {
  const ephemeralScalar = params.ephemeralScalar ?? 0xfeedfacen
  const salt = params.salt ?? 0x2a2an

  const publicViewingKey = pedersenCommit(0n, params.viewingKey)
  const ephemeralPublicKey = pedersenCommit(0n, ephemeralScalar)
  const shared = ecdhSharedScalar(ephemeralScalar, publicViewingKey)

  const amountMask = poseidon2WithDomain(ConfidentialDomain.TRANSFER_AMOUNT, [shared, salt])
  const blinding = poseidon2WithDomain(ConfidentialDomain.TRANSFER_BLINDING, [shared, salt])

  return {
    encryptedAmount: (params.amount + amountMask) % FIELD_MODULUS,
    ephemeralPublicKey,
    salt,
    transferCommitment: pedersenCommit(params.amount, blinding),
  }
}

/** Wraps a transfer in a real `deposit` invocation on the wrapper contract. */
export function buildTransferEnvelope(options: TransferEnvelopeOptions): xdr.TransactionEnvelope {
  const transferArgs = [
    new Address(options.sender).toScVal(),
    new Address(options.recipient).toScVal(),
    xdr.ScVal.scvBytes(encodeTransferData(options.transfer, options.commitmentOverride)),
  ]
  const reference = options.referenceOverride
    ?? (options.reference === null ? null : referenceBytes(options.reference ?? DEFAULT_REFERENCE))

  const invocation = new xdr.InvokeContractArgs({
    args: reference === null ? transferArgs : [xdr.ScVal.scvBytes(reference), ...transferArgs],
    contractAddress: new Address(options.contractAddress).toScAddress(),
    functionName: options.functionName ?? 'deposit',
  })

  const builder = new TransactionBuilder(
    new Account(Keypair.random().publicKey(), '1'),
    { fee: '100', networkPassphrase: Networks.TESTNET },
  )
    .addOperation(Operation.invokeHostFunction({ auth: [], func: xdr.HostFunction.hostFunctionTypeInvokeContract(invocation) }))
    .setTimeout(30)

  const transaction = builder.build()
  if (!options.feeBump) {
    return transaction.toEnvelope()
  }

  return TransactionBuilder
    .buildFeeBumpTransaction(Keypair.random(), '200', transaction, Networks.TESTNET)
    .toEnvelope()
}

export function toBytes32(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
}

/** Serialises `TransferData { payload: TransferPayload, proof: Bytes }`. */
function encodeTransferData(transfer: ConfidentialTransferFixture, commitmentOverride?: Buffer): Buffer {
  const unusedScalar = scvBytes32(1n)

  const payload = scvStruct({
    b_tilde: unusedScalar,
    b_tilde_aud_s: unusedScalar,
    c_spend_new: scvPoint(pedersenCommit(1n, 1n)),
    c_transfer: commitmentOverride ? xdr.ScVal.scvBytes(commitmentOverride) : scvPoint(transfer.transferCommitment),
    r_e_point: scvPoint(transfer.ephemeralPublicKey),
    r_tilde_aud_r: unusedScalar,
    sigma: scvBytes32(transfer.salt),
    v_tilde: scvBytes32(transfer.encryptedAmount),
    v_tilde_aud_r: unusedScalar,
    v_tilde_aud_s: unusedScalar,
  })

  return scvStruct({ payload, proof: xdr.ScVal.scvBytes(Buffer.alloc(16, 7)) }).toXDR()
}

function scvBytes32(value: bigint): xdr.ScVal {
  return xdr.ScVal.scvBytes(toBytes32(value))
}

/** A point is `BytesN<64>` on the wire: `x || y`, not a named-field struct. */
function scvPoint(point: GrumpkinPoint): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.concat([toBytes32(point.x), toBytes32(point.y)]))
}

/** A `#[contracttype]` struct is an ScMap keyed by field-name symbols. */
function scvStruct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort()
    .map(key => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key] }))

  return xdr.ScVal.scvMap(entries)
}
