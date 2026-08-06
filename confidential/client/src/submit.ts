import { readFileSync } from 'node:fs'

import {
  Address,
  Keypair,
  Networks,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'

/**
 * Submits a confidential deposit through Abroad's wrapper contract.
 *
 * The wrapper exists because Soroban transactions cannot carry a memo, and the
 * memo is how Abroad correlates a deposit to a transaction. The reference — the
 * Abroad transaction UUID — travels as an explicit argument instead, and because
 * Soroban authorization covers the whole invocation, the payer's signature
 * covers the reference too.
 *
 * Usage: SECRET=S... tsx src/submit.ts <wrapper> <from> <to> <data-hex-file> <transaction-uuid>
 */

const [wrapper, from, to, dataFile, transactionId] = process.argv.slice(2)
const secret = process.env.SECRET
if (!wrapper || !from || !to || !dataFile || !transactionId || !secret) {
  console.error('usage: SECRET=S... submit.ts <wrapper> <from> <to> <data-hex-file> <transaction-uuid>')
  process.exit(2)
}

const RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET

const reference = Buffer.from(transactionId.replace(/-/g, ''), 'hex')
if (reference.length !== 16) {
  console.error('the reference must be a 16-byte transaction UUID')
  process.exit(2)
}

const keypair = Keypair.fromSecret(secret)
const server = new rpc.Server(RPC_URL)
const data = Buffer.from(readFileSync(dataFile, 'utf8').trim(), 'hex')

const invocation = new xdr.InvokeContractArgs({
  args: [
    xdr.ScVal.scvBytes(reference),
    new Address(from).toScVal(),
    new Address(to).toScVal(),
    xdr.ScVal.scvBytes(data),
  ],
  contractAddress: new Address(wrapper).toScAddress(),
  functionName: 'deposit',
})

const source = await server.getAccount(keypair.publicKey())
const built = new TransactionBuilder(source, { fee: '2000000', networkPassphrase: NETWORK })
  .addOperation(Operation.invokeHostFunction({
    auth: [],
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invocation),
  }))
  .setTimeout(120)
  .build()

const simulated = await server.simulateTransaction(built)
if (rpc.Api.isSimulationError(simulated)) {
  console.error(`simulation failed: ${simulated.error}`)
  process.exit(1)
}

const prepared = rpc.assembleTransaction(built, simulated).build()
prepared.sign(keypair)

const sent = await server.sendTransaction(prepared)
if (sent.status === 'ERROR') {
  console.error(`submission rejected: ${JSON.stringify(sent.errorResult)}`)
  process.exit(1)
}

// Poll the raw RPC: `getTransaction` parses resultMetaXdr, which SDK 13 cannot
// read on protocol 23.
const poll = async (): Promise<string> => {
  const response = await fetch(RPC_URL, {
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'getTransaction', params: { hash: sent.hash } }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  const body = await response.json() as { result: { status: string } }
  return body.result.status
}

let status = await poll()
for (let attempt = 0; attempt < 30 && status === 'NOT_FOUND'; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 2000))
  status = await poll()
}

console.log(JSON.stringify({ hash: sent.hash, status }))
process.exit(status === 'SUCCESS' ? 0 : 1)
