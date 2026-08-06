import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'

import { parseConfidentialTransferCall } from '../../../../../modules/payments/infrastructure/wallets/confidentialTransferCall'
import { buildConfidentialTransfer, buildTransferEnvelope, testAccountAddress, testContractAddress } from './confidentialTestUtils'

const VIEWING_KEY = 0x2b7e151628aed2a6abf7158809cf4f3cn

describe('parseConfidentialTransferCall', () => {
  const contractAddress = testContractAddress()
  const recipient = testAccountAddress()
  const sender = testAccountAddress()
  const transfer = buildConfidentialTransfer({ amount: 4_200n, viewingKey: VIEWING_KEY })

  const envelopeFor = (overrides: Partial<Parameters<typeof buildTransferEnvelope>[0]> = {}) =>
    buildTransferEnvelope({ contractAddress, recipient, sender, transfer, ...overrides })

  const REFERENCE = '3f2b1a90-8c4d-4e21-9b77-5a1c2d3e4f50'

  it('reads the reference, commitment, ciphertext, salt and ephemeral key', () => {
    const parsed = parseConfidentialTransferCall(envelopeFor())

    expect(parsed).toEqual({
      call: {
        contractAddress,
        encryptedAmount: transfer.encryptedAmount,
        ephemeralPublicKey: transfer.ephemeralPublicKey,
        recipient,
        reference: REFERENCE,
        salt: transfer.salt,
        sender,
        transferCommitment: transfer.transferCommitment,
      },
      outcome: 'ok',
    })
  })

  it('reads a fee-bumped transaction through to the inner invocation', () => {
    const parsed = parseConfidentialTransferCall(envelopeFor({ feeBump: true }))

    expect(parsed).toEqual({ call: expect.objectContaining({ reference: REFERENCE }), outcome: 'ok' })
  })

  it('rejects a call to a different contract function', () => {
    // A transfer straight to the token skips the wrapper and carries no
    // reference, so it is unattributable however well-formed it is.
    expect(parseConfidentialTransferCall(envelopeFor({ functionName: 'confidential_transfer' })))
      .toEqual({ outcome: 'rejected', reason: 'not_a_confidential_deposit' })
  })

  it('rejects a deposit whose reference is the wrong width', () => {
    expect(parseConfidentialTransferCall(envelopeFor({ referenceOverride: Buffer.alloc(8) })))
      .toEqual({ outcome: 'rejected', reason: 'malformed_reference' })
  })

  it('rejects an operation that is not a contract invocation', () => {
    const envelope = new TransactionBuilder(
      new Account(Keypair.random().publicKey(), '1'),
      { fee: '100', networkPassphrase: Networks.TESTNET },
    )
      .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
      .setTimeout(30)
      .build()
      .toEnvelope()

    expect(parseConfidentialTransferCall(envelope))
      .toEqual({ outcome: 'rejected', reason: 'not_a_confidential_deposit' })
  })

  it('rejects a deposit with no reference argument at all', () => {
    expect(parseConfidentialTransferCall(envelopeFor({ reference: null })))
      .toEqual({ outcome: 'rejected', reason: 'not_a_confidential_deposit' })
  })

  it('rejects a payload whose commitment is not a valid curve point', () => {
    // 64 bytes that decode to coordinates satisfying no Grumpkin equation.
    expect(parseConfidentialTransferCall(envelopeFor({ commitmentOverride: Buffer.alloc(64, 9) })))
      .toEqual({ outcome: 'rejected', reason: 'malformed_payload' })
  })

  it('rejects a commitment of the wrong width', () => {
    // A point is BytesN<64>; anything else is not a point, however well-formed.
    expect(parseConfidentialTransferCall(envelopeFor({ commitmentOverride: Buffer.alloc(32, 1) })))
      .toEqual({ outcome: 'rejected', reason: 'malformed_payload' })
  })

  it('rejects a data argument that is not XDR at all', () => {
    const envelope = envelopeFor()
    const args = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp().hostFunction().invokeContract().args()
    args[3] = xdr.ScVal.scvBytes(Buffer.from('not xdr'))

    expect(parseConfidentialTransferCall(envelope))
      .toEqual({ outcome: 'rejected', reason: 'malformed_envelope' })
  })

  it('rejects a data argument of the wrong ScVal type', () => {
    const envelope = envelopeFor()
    const args = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp().hostFunction().invokeContract().args()
    args[3] = xdr.ScVal.scvU32(7)

    expect(parseConfidentialTransferCall(envelope))
      .toEqual({ outcome: 'rejected', reason: 'malformed_payload' })
  })
})
