import { Address, xdr } from '@stellar/stellar-sdk'

import { decodeFieldElement, decodePoint, GrumpkinPoint } from './confidentialGrumpkin'

/**
 * Decoder for a confidential deposit made through Abroad's wrapper contract.
 *
 * The `Transfer` event carries the ciphertext but *not* the Pedersen commitment
 * `C_transfer`, so the event alone cannot prove an amount. The commitment travels
 * in the `data` argument of `confidential_transfer(from, to, data)`, and those are
 * the exact bytes the contract fed to the on-chain proof verifier. Reading the
 * invocation of a transaction that succeeded therefore gives us the commitment
 * *and* the fact that a proof verified against it; reading the event would give us
 * neither. Events are only ever used upstream to notice that a transaction exists.
 *
 * Deposits arrive through `deposit(reference, from, to, data)` on Abroad's
 * wrapper rather than directly on the token, because Soroban transactions cannot
 * carry a memo and the memo is how this rail correlates a deposit to a
 * transaction. The reference is an argument instead, so the payer's
 * authorization — which covers the whole invocation — covers it too.
 *
 * A transfer sent straight to the token carries no reference and is
 * unattributable. It fails closed here, as does `confidential_transfer_from`.
 */

const DEPOSIT_FUNCTION = 'deposit'
const DEPOSIT_ARGUMENT_COUNT = 4
/** The reference is the Abroad transaction UUID's 16 bytes. */
const REFERENCE_BYTE_LENGTH = 16
/** `Point` is `BytesN<64>`: the two 32-byte coordinates, concatenated. */
const POINT_BYTE_LENGTH = 64

export type ConfidentialTransferCallFailure
  = | 'malformed_envelope'
    | 'malformed_payload'
    | 'malformed_reference'
    | 'not_a_confidential_deposit'

type ConfidentialTransferCall = {
  /** Wrapper contract the invocation targeted, as a `C…` strkey. */
  contractAddress: string
  /** `v_tilde`. */
  encryptedAmount: bigint
  /** `R_e`. */
  ephemeralPublicKey: GrumpkinPoint
  /** The `to` argument, as a strkey. */
  recipient: string
  /** The Abroad transaction this deposit pays, as a UUID. */
  reference: string
  /** `sigma`. */
  salt: bigint
  /** The `from` argument, as a strkey. */
  sender: string
  /** `C_transfer`, the commitment credited to the recipient's receiving balance. */
  transferCommitment: GrumpkinPoint
}

type ConfidentialTransferCallOutcome
  = | { call: ConfidentialTransferCall, outcome: 'ok' }
    | { outcome: 'rejected', reason: ConfidentialTransferCallFailure }

/**
 * Decodes a transaction envelope into the confidential transfer it invoked.
 *
 * Every field is taken from the envelope; nothing is accepted from a caller. The
 * decoder tolerates arbitrary bytes and never throws.
 */
export function parseConfidentialTransferCall(
  envelope: xdr.TransactionEnvelope,
): ConfidentialTransferCallOutcome {
  try {
    return decode(envelope)
  }
  catch {
    // js-xdr accessors throw on a union read that does not match the discriminant.
    // Any such surprise is an envelope we do not understand, not a usable deposit.
    return { outcome: 'rejected', reason: 'malformed_envelope' }
  }
}

function decode(envelope: xdr.TransactionEnvelope): ConfidentialTransferCallOutcome {
  const transaction = readInnerTransaction(envelope)
  if (!transaction) {
    return { outcome: 'rejected', reason: 'malformed_envelope' }
  }

  const invocation = readContractInvocation(transaction)
  if (!invocation) {
    return { outcome: 'rejected', reason: 'not_a_confidential_deposit' }
  }

  if (readSymbol(invocation.functionName()) !== DEPOSIT_FUNCTION) {
    return { outcome: 'rejected', reason: 'not_a_confidential_deposit' }
  }

  const args = invocation.args()
  if (args.length !== DEPOSIT_ARGUMENT_COUNT) {
    return { outcome: 'rejected', reason: 'not_a_confidential_deposit' }
  }

  const [referenceArgument, senderArgument, recipientArgument, dataArgument] = args
  const reference = readReference(referenceArgument)
  if (!reference) {
    return { outcome: 'rejected', reason: 'malformed_reference' }
  }

  const sender = readAddress(senderArgument)
  const recipient = readAddress(recipientArgument)
  const data = readBytes(dataArgument)
  if (!sender || !recipient || !data) {
    return { outcome: 'rejected', reason: 'malformed_payload' }
  }

  const payload = readTransferPayload(data)
  if (!payload) {
    return { outcome: 'rejected', reason: 'malformed_payload' }
  }

  return {
    call: {
      contractAddress: Address.fromScAddress(invocation.contractAddress()).toString(),
      recipient,
      reference,
      sender,
      ...payload,
    },
    outcome: 'ok',
  }
}

function readAddress(value: xdr.ScVal): null | string {
  if (value.switch().name !== 'scvAddress') {
    return null
  }
  return Address.fromScAddress(value.address()).toString()
}

function readBytes(value: xdr.ScVal): Buffer | null {
  return value.switch().name === 'scvBytes' ? value.bytes() : null
}

function readContractInvocation(transaction: xdr.Transaction): null | xdr.InvokeContractArgs {
  const operations = transaction.operations()
  // A Soroban transaction carries exactly one operation; anything else is not one.
  if (operations.length !== 1) {
    return null
  }

  const body = operations[0].body()
  if (body.switch().name !== 'invokeHostFunction') {
    return null
  }

  const hostFunction = body.invokeHostFunctionOp().hostFunction()
  if (hostFunction.switch().name !== 'hostFunctionTypeInvokeContract') {
    return null
  }

  return hostFunction.invokeContract()
}

function readField(value: xdr.ScVal, key: string): null | xdr.ScVal {
  if (value.switch().name !== 'scvMap') {
    return null
  }

  const entries = value.map()
  if (!entries) {
    return null
  }

  for (const entry of entries) {
    const entryKey = entry.key()
    if (entryKey.switch().name === 'scvSymbol' && readSymbol(entryKey.sym()) === key) {
      return entry.val()
    }
  }

  return null
}

function readFieldElement(value: null | xdr.ScVal): bigint | null {
  if (!value) {
    return null
  }
  const bytes = readBytes(value)
  return bytes ? decodeFieldElement(bytes) : null
}

function readInnerTransaction(envelope: xdr.TransactionEnvelope): null | xdr.Transaction {
  // Only the two envelope shapes that can carry a Soroban invocation are read.
  // Every other discriminant of the XDR union is not a transaction we can act on.
  if (envelope.switch().name === 'envelopeTypeTx') {
    return envelope.v1().tx()
  }

  if (envelope.switch().name === 'envelopeTypeTxFeeBump') {
    const inner = envelope.feeBump().tx().innerTx()
    return inner.switch().name === 'envelopeTypeTx' ? inner.v1().tx() : null
  }

  return null
}

/**
 * Reads a Grumpkin point.
 *
 * On the wire a point is `BytesN<64>` — `x || y`, each 32 bytes big-endian —
 * not a struct with named coordinates. `Point` is a type alias for `BytesN<64>`
 * in `stellar_contract_utils::crypto::grumpkin`, so the payload carries 64 raw
 * bytes where a `#[contracttype]` struct would have carried a map.
 */
function readPoint(value: null | xdr.ScVal): GrumpkinPoint | null {
  if (!value) {
    return null
  }

  const bytes = readBytes(value)
  if (!bytes || bytes.length !== POINT_BYTE_LENGTH) {
    return null
  }

  return decodePoint(bytes.subarray(0, 32), bytes.subarray(32))
}

/** Reads the 16-byte reference and renders it as the transaction's UUID. */
function readReference(value: xdr.ScVal): null | string {
  const bytes = readBytes(value)
  if (!bytes || bytes.length !== REFERENCE_BYTE_LENGTH) {
    return null
  }

  const hex = bytes.toString('hex')
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20),
  ].join('-')
}

function readSymbol(value: Buffer | string): string {
  return typeof value === 'string' ? value : value.toString('utf8')
}

/**
 * Reads the fields this verifier needs out of `TransferData { payload, proof }`.
 *
 * The `proof` blob is intentionally ignored: it was already verified on chain by
 * the contract, which is the only place it can be verified, and re-reading it here
 * would suggest an independent check we are not performing.
 */
function readTransferPayload(data: Buffer): null | Pick<
  ConfidentialTransferCall,
  'encryptedAmount' | 'ephemeralPublicKey' | 'salt' | 'transferCommitment'
> {
  const payload = readField(xdr.ScVal.fromXDR(data), 'payload')
  if (!payload) {
    return null
  }

  const encryptedAmount = readFieldElement(readField(payload, 'v_tilde'))
  const ephemeralPublicKey = readPoint(readField(payload, 'r_e_point'))
  const salt = readFieldElement(readField(payload, 'sigma'))
  const transferCommitment = readPoint(readField(payload, 'c_transfer'))

  if (encryptedAmount === null || !ephemeralPublicKey || salt === null || !transferCommitment) {
    return null
  }

  return { encryptedAmount, ephemeralPublicKey, salt, transferCommitment }
}
