# Stellar Summit São Paulo 2026 — Confidential deposits, real payouts

**Lane:** Privacy (OpenZeppelin + Nethermind) · *Confidential-token & private-payment wallets*

## What this event branch adds

A deposit path into Abroad's Brazilian payment rail where **the amount is invisible on-chain and the
money still comes out the other end as Brazilian reais.** A payer sends an OpenZeppelin
confidential-token transfer; observers see that two addresses transacted, not how much; Abroad
recovers the amount with its viewing key, proves it against the Pedersen commitment the contract
credited, and hands it to the same deposit queue every other network uses — where the rail that
already settles PIX payouts in production takes it the rest of the way.

Abroad takes every Stellar deposit on **one** account today, correlated by a memo, so Horizon
publishes the whole business: total volume, every payment, timing, growth rate. This closes that leak
on the leg where the commercial detail lives, without touching the settlement that already works.

## Where to find it

| | |
| --- | --- |
| Branch | `hleon/confidential-wallets-plan-0f5549`, on top of `cb3d8ff` |
| Pull request | https://github.com/abroad-finance/abroad/pull/79 |
| Release tag | none — the path ships disabled, see *Safe by construction* |

## The claim worth checking

Hiding an amount is easy. Releasing real money against a hidden amount is the hard part.

Abroad's classic Stellar verifier trusts the plaintext `amount` string Horizon reports. The
confidential one trusts nothing it is told:

```
s = Poseidon2(δ_ecdh, S.x, S.y)          where S = vk · R_e
v = ṽ − Poseidon2(δ_transfer_amount, s, σ)
r = Poseidon2(δ_transfer_blind,  s, σ)
                                          require  v·G + r·H == c_transfer
```

It recovers the amount, re-derives the blinding factor, recommits, and demands the result equal the
on-chain commitment byte for byte. Under Pedersen binding no second opening exists, so `v` is not a
plausible amount — it is the only amount that transfer could have moved. **The hidden path is a
strictly stronger proof than the visible one.**

## Live on testnet

| | |
| --- | --- |
| Confidential token | `CDX6HMFYPI4AVRU3E43NN3FNSYXOOIYKTI2LRFNKIJSLLNV56CGWD53L` |
| Verifier registry | `CAVP6ZM5YFPNJZTLMCHK5NFUS44T6WWT4I6B7V5TXRHM5XVNPJJCPYUK` |
| Deposit wrapper | `CCQ7EUXCQCNTCE4YOTU2IFWQ4YNSEHWPGTNTBCCHX2U7ESFY5RGI4HML` |
| Auditor registry | `CA7SPB5WZBSVSDHMEWANC4HWZUPPYBUV3LFWXIY66HQXRBUEMDQ3LDPT` |
| UltraHonk backends | `CBRUYTBE…ZRJX` (register), `CCN36TJV…ET3D` (transfer) |

A real confidential deposit of **12.3456789 XLM**:
[`4fd6a754…`](https://stellar.expert/explorer/testnet/tx/4fd6a7542e94d46dab921f46aa730c789478c9e5ee0b892071c310d4b552a753)

Open it — the amount is not there. Run this branch's verifier against it and it reads the Abroad
transaction reference `3f2b1a90-8c4d-4e21-9b77-5a1c2d3e4f50`, recovers `123456789` minor units, and
the commitment check passes. Attribution and amount, both proven off a live ledger.

On-chain UltraHonk verification costs **~0.0125 XLM** and fits the standard testnet budget with no
raised limits.

## Verify it yourself

Nothing below needs our word for it. Every link is Stellar testnet, and the code
that reads them is in this repository.

| What | Transaction |
| --- | --- |
| UltraHonk proof verified **on chain** | [`804cbbcc…`](https://stellar.expert/explorer/testnet/tx/804cbbcc8274f918f56cca04725f1452810ee51f7a73d4b0e86cb674068d308a) |
| Confidential transfer, amount hidden | [`c56833ff…`](https://stellar.expert/explorer/testnet/tx/c56833ff13afbd551bcefb2b0473d5495f7bf887386f7bc0a8bda88208f8b182) |
| Deposit through the wrapper, carrying a signed reference | [`4fd6a754…`](https://stellar.expert/explorer/testnet/tx/4fd6a7542e94d46dab921f46aa730c789478c9e5ee0b892071c310d4b552a753) |
| Further deposits on the same path | [`994ac0ba…`](https://stellar.expert/explorer/testnet/tx/994ac0bab083182e8d2c8b9f6243341a628ac2025163497dbb027e315b473a44) · [`6759cfbc…`](https://stellar.expert/explorer/testnet/tx/6759cfbc5a6cd249d9505d59fa0bad8a19e8155fb98300ec54736a7bfa07849b) |

**Open any of the transfers.** There is no amount in them. The event carries an
ephemeral public key, a salt and ciphertexts; the payload carries a Pedersen
commitment. Nowhere does it say 12.3456789.

**Then recover it.** With the recipient's viewing key, this branch's
`recoverDisclosedAmount` returns `123456789` minor units from
[`c56833ff…`](https://stellar.expert/explorer/testnet/tx/c56833ff13afbd551bcefb2b0473d5495f7bf887386f7bc0a8bda88208f8b182)
and the commitment check passes. The viewing key is the whole point: without it
the transaction is opaque, with it the amount is not merely readable but
*provable* against bytes already on the ledger.

**And check the keys are what we say.** The verification key this registry holds
is byte-identical to the one the backend holds, and both reproduce from
OpenZeppelin's circuit sources with the pinned toolchain:

```bash
stellar contract invoke --id CAVP6ZM5YFPNJZTLMCHK5NFUS44T6WWT4I6B7V5TXRHM5XVNPJJCPYUK   --network testnet -- get_verification_key --circuit_type 0
stellar contract invoke --id CBRUYTBE53EOSL5PFVG4G2THYWJ2DWX7OTUKYCGWCBBC3ZRLF7ZRZRJX   --network testnet -- vk_bytes
```

That is the audit trail end to end: circuit source → pinned toolchain → deployed
verification key → on-chain proof → recovered amount → committed value.

## Both sponsors, in one call path

OpenZeppelin's confidential-token suite ships no deployable token contract, and its
`ConfidentialVerifier` trait ships **no `verify_proof` at all** — the backend is left to the
integrator. Nethermind's `rs-soroban-ultrahonk` is that backend. This branch wrote the two contracts
that join them: a verifier registry delegating per circuit to a deployed UltraHonk instance, and the
token that consumes it.

It also closes the correlation gap the primitive leaves open. Soroban transactions cannot carry a
memo, and a memo is how a payment rail knows whose deposit it just received. A small wrapper contract
carries the transaction reference as a **signed** argument, so a deposit is attributable and a
front-runner cannot re-point someone else's payment at another customer's transaction.

## What is new, and what is the existing production rail

New here:

| Component | What it does |
| --- | --- |
| `confidentialGrumpkin.ts` | Grumpkin curve and Poseidon2 primitives of the protocol |
| `confidentialDisclosure.ts` | Recovers the amount by ECDH and proves it against the commitment |
| `confidentialTransferCall.ts` | Decodes the deposit invocation and its XDR payload |
| `ConfidentialDepositVerifier.ts` | The deposit verifier |
| `StellarConfidentialListener.ts` | Polls Soroban RPC and enqueues through the outbox |
| `confidential/contracts/*` | The token, verifier registry and deposit wrapper |
| `confidential/client/*` | The payer client that builds and submits a deposit |

Everything after the deposit lands was already in production and is **not modified** by this branch:
`TransactionStateMachine`, `FlowOrchestrator`, `PayoutSendStepExecutor`, Transfero Ultra, refunds,
webhooks, liquidity admission. The classic Stellar deposit path is untouched. That is the point — the
confidential leg is a new front door onto a rail that already settles real money.

## Safe by construction

This lands **dark**. The path needs an explicitly enabled `ConfidentialAssetConfig` row and three
secrets before it does anything at all; the migration inserts nothing and the listener logs that it is
idle. Zero blast radius on the rail that moves customer money, which is what let it be built against
production code instead of in a demo repo.

Correctness is pinned to **OpenZeppelin's own cross-language conformance vectors**, copied verbatim
into `abroad-server/src/tests/fixtures/confidential/` and reproduced byte-for-byte — passing them is
the protocol's definition of a conformant implementation, not ours. Above that, tests build genuine
transfers in genuine XDR envelopes and refuse a wrong contract, wrong recipient, wrong reference,
replayed on-chain id, tampered ciphertext, mismatched commitment, out-of-range amount and a dead RPC.

## How to run it

```bash
npm ci
npm -w abroad run test -- src/tests/modules/payments/infrastructure/wallets/confidential --runInBand
npm -w abroad run test -- src/tests/modules/treasury/interfaces/listeners --runInBand
```

The contracts and the payer client that produced the testnet transactions above live in
[`confidential/`](./confidential); its README reproduces the whole run, from installing the pinned
Noir and Barretenberg toolchain through deploying and sending a deposit.

Four files carry the argument:

- `abroad-server/.../confidentialDisclosure.ts` — the recovery and the commitment check
- `abroad-server/.../ConfidentialDepositVerifier.ts` — the rejection matrix
- `confidential/contracts/deposit/src/lib.rs` — why the reference must be signed
- `confidential/README.md` — reproducing the testnet run
