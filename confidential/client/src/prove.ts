import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { xdr } from '@stellar/stellar-sdk'

import type { Point } from './protocol'

/**
 * Proof generation and payload encoding.
 *
 * The two `bb` flags are not optional. `--oracle_hash keccak` is required
 * because the on-chain verifier reproduces the Fiat–Shamir transcript with
 * Keccak while `bb` defaults to Poseidon2, and `--zk` must be absent because
 * the deployed backend implements only the non-zk flavor. A proof that ignores
 * either is rejected on chain with no useful diagnostic.
 */

const CIRCUITS_DIR = join(
  import.meta.dirname,
  '../../oz/packages/tokens/src/confidential/circuits',
)

export type Proof = {
  proof: Buffer
  publicInputs: Buffer
}

/** Runs `nargo execute` + `bb prove` for one circuit against a witness. */
export function prove(circuit: string, witness: Record<string, string>): Proof {
  const packageName = `circuit_${circuit}`
  const toml = Object.entries(witness)
    .map(([key, value]) => `${key} = "${value}"`)
    .join('\n')
  writeFileSync(join(CIRCUITS_DIR, circuit, 'Prover.toml'), `${toml}\n`)

  const witnessName = `${circuit}_witness`
  run('nargo', ['execute', '--package', packageName, witnessName], CIRCUITS_DIR)

  const out = mkdtempSync(join(tmpdir(), 'ozproof-'))
  run('bb', [
    'prove',
    '-s', 'ultra_honk',
    '--oracle_hash', 'keccak',
    '-b', join(CIRCUITS_DIR, 'target', `${packageName}.json`),
    '-w', join(CIRCUITS_DIR, 'target', `${witnessName}.gz`),
    '-o', out,
  ], CIRCUITS_DIR)

  return {
    proof: readFileSync(join(out, 'proof')),
    publicInputs: readFileSync(join(out, 'public_inputs')),
  }
}

/** Writes the verification key for a circuit, in the backend's byte format. */
export function writeVerificationKey(circuit: string, outputDir: string): string {
  const packageName = `circuit_${circuit}`
  run('nargo', ['compile', '--package', packageName], CIRCUITS_DIR)
  run('bb', [
    'write_vk',
    '-s', 'ultra_honk',
    '--oracle_hash', 'keccak',
    '-b', join(CIRCUITS_DIR, 'target', `${packageName}.json`),
    '-o', outputDir,
  ], CIRCUITS_DIR)
  return join(outputDir, 'vk')
}

/**
 * Encodes a `#[contracttype]` struct: an ScMap keyed by field-name symbols.
 *
 * Soroban's XDR is canonical, so a client that compiles against the same
 * definitions produces byte-identical payloads to any other.
 */
export function scvStruct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort()
    .map(key => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key] }))
  return xdr.ScVal.scvMap(entries)
}

export function scvField(value: bigint): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(value.toString(16).padStart(64, '0'), 'hex'))
}

/**
 * A Grumpkin point on the wire is `BytesN<64>` — `x || y`, each 32 bytes
 * big-endian — not a struct with named coordinates
 * (`stellar_contract_utils::crypto::grumpkin::Point`).
 */
export function scvPoint(point: Point): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.concat([
    Buffer.from(point.x.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from(point.y.toString(16).padStart(64, '0'), 'hex'),
  ]))
}

/** `RegisterData { payload: RegisterPayload { y, pvk }, proof }` as hex. */
export function encodeRegisterData(params: {
  proof: Buffer
  pvk: Point
  y: Point
}): string {
  return scvStruct({
    payload: scvStruct({ pvk: scvPoint(params.pvk), y: scvPoint(params.y) }),
    proof: xdr.ScVal.scvBytes(params.proof),
  }).toXDR().toString('hex')
}

/** `TransferData { payload: TransferPayload { … }, proof }` as hex. */
export function encodeTransferData(params: {
  bTilde: bigint
  bTildeAudS: bigint
  cSpendNew: Point
  cTransfer: Point
  proof: Buffer
  rEPoint: Point
  rTildeAudR: bigint
  sigma: bigint
  vTilde: bigint
  vTildeAudR: bigint
  vTildeAudS: bigint
}): string {
  return scvStruct({
    payload: scvStruct({
      b_tilde: scvField(params.bTilde),
      b_tilde_aud_s: scvField(params.bTildeAudS),
      c_spend_new: scvPoint(params.cSpendNew),
      c_transfer: scvPoint(params.cTransfer),
      r_e_point: scvPoint(params.rEPoint),
      r_tilde_aud_r: scvField(params.rTildeAudR),
      sigma: scvField(params.sigma),
      v_tilde: scvField(params.vTilde),
      v_tilde_aud_r: scvField(params.vTildeAudR),
      v_tilde_aud_s: scvField(params.vTildeAudS),
    }),
    proof: xdr.ScVal.scvBytes(params.proof),
  }).toXDR().toString('hex')
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, PATH: `${process.env.HOME}/.nargo/bin:${process.env.HOME}/.bb:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
