# Float that earns until the moment it's spent

**Stellar Summit São Paulo 2026 — Anchors and Ramps (Etherfuse), emerging-market yield.**

Abroad's crypto delivery inventory held in Etherfuse **TESOURO**, accruing Brazilian sovereign yield
until a customer buys — then unwound automatically, mid-flow, to fund the delivery. With an admission
gate that refuses any purchase it cannot deliver, built into the production treasury module.

---

## The thesis

A Brazilian pays with PIX and receives USDC. To make that instant, Abroad has to be holding the USDC
before anyone asks for it. That inventory is what buys the speed, and it earns nothing.

Park it in TESOURO. Unwind just-in-time to fund the delivery.

The result is a sentence that is literally true of the production system: **the coins a customer
receives were a yield-bearing Brazilian government bond moments earlier.** And because it is treasury
rather than a consumer product, it adds no new regulatory surface — Abroad stays a payments rail, not
an issuer of a Brazilian retail investment product.

**Why the delivery side and not the BRL payout float.** The position and the delivery inventory live
on the *same Stellar account*: `CRYPTO_SEND` pays onramp customers from it, and
`CryptoInventoryService` gates acceptance on it. So an unwind lands USDC exactly where it is about to
be spent, in one ledger, with nothing to transfer and nothing to wait for. The BRL payout float sits
at Transfero and settles from Binance — reachable only across a bridge, which would make
"just-in-time" aspirational rather than true.

## What the two hard gates actually returned

Both were resolved against public, unauthenticated endpoints on 2026-08-06. No credential was used
and no account was created.

**Gate 1 — TESOURO is a classic Stellar asset**, not a Soroban contract token.

```
TESOURO-GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC
asset_type: credit_alphanum12   decimals: 7   authorized accounts: 175
flags: auth_required false · auth_revocable false · auth_clawback_enabled false
```

Those three flags are what make this a treasury-safe asset rather than merely an available one:
**anyone can open a trustline and hold TESOURO without the issuer authorizing it** — there is no KYB
gate at the asset level — and once the float is in TESOURO the issuer can neither freeze it nor claw
it back.

Stellar is TESOURO's largest chain by supply (2.48M of 3.33M net tokens). Confirmed from Etherfuse's
`GET /lookup/stablebonds` and cross-checked on Horizon's `/assets`. Every Etherfuse Stablebond on
Stellar — TESOURO, CETES, USTRY, EUROB, KTB, GILTS, MEX — shares that one issuer, which makes a
multi-currency float a configuration change rather than a new integration.

**Gate 2 — the unwind clears in one ledger, at 4–6 bps.** Horizon `/paths/strict-send`:

| Unwind size | Received | Effective USD/TESOURO | Hops | Spread vs NAV |
| --- | --- | --- | --- | --- |
| 1,000 TESOURO | 242.5813394 USDC | 0.2425813 | 0 (direct) | **5.8 bps** |
| 25,000 TESOURO | 6,065.8329287 USDC | 0.2426333 | 0 (direct) | **3.6 bps** |

A direct TESOURO/USDC market, single hop, ~5 s to inclusion. Touch spread 5 bps; 53,428 TESOURO of
bid depth within 0.12% of top of book.

**So the just-in-time thesis holds.** The unwind costs ~4–6 bps against an accrual rate of 1,276
bps/yr — the round trip pays for itself in under two days of holding, and five seconds is far inside
the window a customer waits for their coins. No reframe to a scheduled sweep was needed.

`TESOURO -> BRZ` returns no path on Stellar. USDC is the only liquid exit — which is exactly right,
because USDC is what the delivery inventory is denominated in and what customers receive.

## What this branch adds

| New | File |
| --- | --- |
| NAV + yield oracle (Etherfuse public lookup) | `abroad-server/src/modules/treasury/infrastructure/stablebond/EtherfuseStablebondClient.ts` |
| Permissionless venue: trustline + both directions of the path payment | `.../infrastructure/stablebond/StellarDexVenue.ts` |
| Position as a treasury venue | `.../infrastructure/balanceSources/StablebondBalanceSource.ts` |
| Position: read, value, basis | `.../application/StablebondPositionService.ts` |
| Accrual accounting, exact decimals | `.../application/YieldAccrualService.ts` |
| Quoted acquire and unwind, both slippage-bounded | `.../application/JustInTimeUnwindService.ts` |
| Ops read model + step-up mutations | `.../application/OpsStablebondService.ts`, `.../interfaces/http/OpsStablebondController.ts` |
| **Automatic unwind, mid-flow** | `abroad-server/src/modules/flows/application/steps/StablebondUnwindStepExecutor.ts` |
| Unwind-feasibility admission gate | `abroad-server/src/modules/transactions/application/TransactionAcceptanceService.ts` |
| Ops panel | `abroad-ui/src/pages/Ops/treasury/StablebondPanel.tsx` |
| `StablebondPosition`, `StablebondExecution` | `abroad-server/prisma/migrations/20260806140000_stablebond_position/` |

Abroad had **no** concept of a yield-bearing position before this — no NAV, no accrual, no
redemption anywhere in the codebase. This is new capability, not a re-skin.

## Treasury safety invariants

This touches production money. The invariants are not optional, and each one is tested.

1. **Never accept a purchase you cannot deliver.** The admission gate is the safety property;
   everything else is optimisation. A purchase the liquid inventory cannot cover is admitted only if
   a *live* quote proves the shortfall can be unwound inside the slippage bound.
2. **Never treat an unreadable balance as available float.** An unreadable position, an unreadable
   NAV, or a NAV quoted in the wrong currency all refuse. None of them resolve to zero.
3. **Quote before committing; bound the slippage; refuse rather than execute past the bound.** The
   bound also goes on chain as `destMin`, so the network rejects a fill past it even if the book
   moves after we looked.
4. **Persist the execution before the venue is asked to act.** An ambiguous submission is reconciled
   read-only by transaction hash. It is never re-executed — a second submission is a second sale.
5. **Exact decimal arithmetic.** `Prisma.Decimal` throughout, `DECIMAL(36,18)` columns. No binary
   floating point in the value ledger.
6. **Cross-process locking on the position**, and the venue takes the *same* Stellar source-account
   lock as customer withdrawals, because they share a sequence number.
7. **Ships dark behind a cap.** An unset `STABLEBOND_JIT_UNWIND_CAP_USDC` means disabled, following
   `BRIDGE_FLOAT_CAP_USDC`. With it unset the admission gate is a no-op, the flow step is a no-op,
   and the onramp path behaves exactly as it did before.
8. **No polling of rate-limited provider balance endpoints.** The feasibility probe is cached, and
   the admission gate only consults the venue on the path that was already about to reject.

## Configuration

Everything is off until the cap is set. There is deliberately **no default issuer**: Etherfuse's own
documentation warns that the Stellar issuer differs between sandbox and production and can change, so
an operator has to say which issuer they mean.

```bash
STABLEBOND_JIT_UNWIND_CAP_USDC=100     # the on switch, and the ceiling on JIT reliance
STABLEBOND_ISSUER=GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC
STABLEBOND_SYMBOL=TESOURO              # default
STABLEBOND_ASSET_CODE=TESOURO          # defaults to the symbol
STABLEBOND_FIAT_CURRENCY=BRL           # default
STABLEBOND_MAX_SLIPPAGE_BPS=50         # default; hard ceiling 500
```

Both are pinned as Cloud Build substitutions and re-applied on every deploy, reaching **three**
surfaces: `abroad-api` for the admission gate, and the `abroad-consumers` and `abroad-bridge-sweep`
workers for the flow step. They have to agree — a gate that is on while the step is off would admit a
purchase against an unwind that never happens, and the delivery would fail on chain.

The flow step is added to an onramp corridor's definition as `STABLEBOND_UNWIND`, placed before
`CRYPTO_SEND`. A definition carrying the step keeps delivering normally while the position is off.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/ops/treasury/stablebond` | `treasury:read` |
| `POST` | `/ops/treasury/stablebond/trustline` | `treasury:manage`, step-up |
| `POST` | `/ops/treasury/stablebond/acquisitions` | `treasury:manage`, step-up |
| `POST` | `/ops/treasury/stablebond/unwinds` | `treasury:manage`, step-up |
| `POST` | `/ops/treasury/stablebond/basis` | `treasury:manage`, step-up |

## Sponsor integration, and why no KYB is needed

**Nothing in this build requires an Etherfuse relationship.** That is a design property, not a
consolation: `auth_required: false` means the trustline opens and the asset trades with no issuer
involvement at all, and the native DEX is both the way in and the way out.

The Etherfuse dependency that *is* here is their **public lookup API** —
`GET /lookup/bonds/cost/{symbol}` — which supplies NAV in both BRL and USD plus the live yield in
basis points (`current_basis_points: 1276`). It needs no API key and no account. It is a real
integration against a sponsor endpoint that no credential decision can switch off, and it is the
source of every valuation and accrual number in the console.

Etherfuse's authenticated swap endpoints (`POST /ramp/quote`, `POST /ramp/swap`) exist and are
documented. They are **not** wired here:

- They need an API key from a business account, and production access needs real KYB. The only thing
  that access actually buys is primary issuance and redemption at NAV, which avoids the
  secondary-market spread — and at 4–6 bps that is worth very little.
- This repo has a standing rule, learned the hard way on the Transfero Ultra integration: never infer
  a request body from docs prose instead of probing the live endpoint. Shipping an unexercised
  money-moving path into a treasury module would be exactly the speculative code AGENTS.md forbids.

`IStablebondVenue` is shaped so a swap-API adapter can be added later as a second quote source
without touching the execution service's contract.

**Also deliberately out of scope:** the Blend / Soroswap composability clause. Using Stablebonds as
lending collateral is a different product from spending against them, and it would put Abroad in a
corridor it has no advantage in. That is a scope decision, not an omission.

## Validation

```bash
npm -w abroad run test -- src/tests/modules/treasury --runInBand
npm -w abroad run checks:mandatory
npm -w abroad-ui run test && npm -w abroad-ui run typecheck
```

Covered explicitly:

- accrual arithmetic exact to the decimal, including the case where binary floating point is wrong
- an unwind past the slippage bound is refused, not executed
- an ambiguous unwind reconciles read-only and never double-executes
- admission refuses when the unwind cannot clear the window, with a bounded customer-facing reason
- an unreadable position refuses rather than assuming zero
- the existing onramp and payout regression suites stay green with the gate disabled

## The full round trip

Because there is no counterparty, the entire lifecycle is code in this branch.

**Setting up the position** — three buttons on the treasury console, for an operator holding
`treasury:manage`, each behind step-up authentication, a typed confirmation phrase, a written reason
and an idempotency key:

1. **Open trustline** — one `changeTrust` operation. Idempotent: an existing trustline is reported,
   never re-created.
2. **Acquire** — buy in, bounded by the same slippage tolerance as the unwind, with the bound on
   chain as `destMin`. Basis is taken from the fill, never the quote.
3. The position accrues, and the console shows the accrual and the live cost of getting out.

**Spending it — no operator involved.** A customer buys. The `STABLEBOND_UNWIND` step runs
immediately before `CRYPTO_SEND`, reads inventory fresh, and:

- converts **only the shortfall** — a delivery the liquid inventory already covers pays no spread at
  all and touches no venue;
- keys the unwind on `(transactionId, stepOrder)`, so a retried step re-attaches to the execution in
  flight and reconciles it rather than selling twice;
- fails the step rather than delivering short if the unwind is refused or ambiguous.

An **Unwind** button remains on the console for operators, and reports an ambiguous execution with
its id and an explicit instruction not to retry — never as a failure a client would repeat.

## Status

Built, tested and merged into the treasury module, shipped dark. Enabling it in production is a
config value plus written authorization naming the position size, per AGENTS.md — the mainnet proof
has not been run, so no trustline is open and no position is held.

Everything that proof needs is in place: the trustline operation, the bounded buy, the automatic
just-in-time sell, the accrual ledger, and an admission gate that refuses anything it cannot
deliver.
