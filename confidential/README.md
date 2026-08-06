# Confidential deposits — contracts and payer client

Everything needed to reproduce the confidential deposit path that
[`../EVENT.md`](../EVENT.md) describes: the Soroban contracts Abroad deploys, and
the command-line client a payer uses to build and submit a deposit.

This is not part of the server or UI build. It has its own Rust workspace and its
own `package.json`, in the same way `docs/` is a separate package — `npm ci` at
the repository root does not touch it.

**Testnet only.** OpenZeppelin marks the confidential-token module not production
ready: its UltraHonk verifier backend is unaudited, and the README says not to
deploy it anywhere handling real value.

## Layout

```
contracts/
  token/      Confidential token — a shell over OpenZeppelin's ConfidentialToken
  verifier/   Verification-key registry, delegating to Nethermind's UltraHonk backend
  deposit/    Abroad's wrapper, carrying the transaction reference
client/
  src/protocol.ts        Grumpkin + Poseidon2 primitives (sender side)
  src/prove.ts           nargo/bb proving and XDR payload encoding
  src/register.ts        Registers a confidential account
  src/transfer.ts        Builds a confidential transfer
  src/submit.ts          Submits a deposit through the wrapper
  src/verify-vectors.ts  Replays OpenZeppelin's conformance vectors
```

## Why there is a wrapper contract

Soroban transactions **cannot carry a memo** — the network rejects any transaction
containing both a Soroban operation and one. Abroad has a single deposit account
and the memo is how every other deposit is correlated to a transaction, so a
confidential deposit would be unattributable.

`deposit(reference, from, to, data)` carries the Abroad transaction UUID as an
explicit argument and forwards `data` to the token untouched. It calls
`from.require_auth()` so the payer's signature covers the reference; without that,
an observer could resubmit a pending payload under a different reference and
credit one customer's deposit to another customer's transaction.

## Prerequisites

The toolchain versions are the ones OpenZeppelin pins; the verification keys are
byte-sensitive to them.

```bash
noirup -v 1.0.0-beta.11
bbup -v 0.87.0
rustup target add wasm32v1-none
brew install stellar-cli
```

The contracts build against a checkout of `OpenZeppelin/stellar-contracts` beside
this directory (`../oz` relative to `contracts/`), and the client's prover reads
the circuits from the same checkout.

## Reproducing

```bash
# 1. Confirm the client agrees with the protocol before anything touches a network
cd client && npm install && npx tsx src/verify-vectors.ts

# 2. Build and deploy. Each circuit needs its own UltraHonk backend instance,
#    deployed from NethermindEth/rs-soroban-ultrahonk with that circuit's VK.
cd ../contracts && stellar contract build

# 3. Register an account, then send a deposit
npx tsx src/register.ts <token> <account> account.secret.json
SECRET=S... npx tsx src/submit.ts <wrapper> <from> <to> data.hex <transaction-uuid>
```

`deployment.env` records the current testnet addresses.

## Secrets

`register.ts` and `gen-auditor-key.ts` write key material to `*.secret.json` at
mode 0600, and `.gitignore` excludes it. A viewing key decrypts every amount that
account ever receives — treat it as a live credential even on testnet, and never
commit one.
