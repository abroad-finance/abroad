# Wire per-route commission into quote pricing

**Date:** 2026-06-01
**Status:** Approved design — ready for implementation plan

## Problem

The Ops "Corridor Flow Builder" form ([abroad-ui/src/pages/Ops/FlowDefinitions.tsx](../../../abroad-ui/src/pages/Ops/FlowDefinitions.tsx)) lets operators set an **Exchange Fee %** and **Fixed Fee** (plus min/max amounts) per route. Those values are persisted to the `FlowDefinition` table and round-tripped through the flow snapshot, but **no pricing code ever reads them back**. The customer-facing price is computed in [abroad-server/src/modules/quotes/application/quoteUseCase.ts](../../../abroad-server/src/modules/quotes/application/quoteUseCase.ts) using **hardcoded provider constants** instead:

- percentage fee → `exchangeRateProvider.exchangePercentageFee` (Binance `0.0085`, Transfero `0.001`)
- fixed fee → `paymentService.fixedFee` (`0` for both BREB and Transfero)
- limits → `paymentService.MIN/MAX_USER_AMOUNT_PER_TRANSACTION`

A leftover `// TODO: Add percentage fee calculation when available` at `quoteUseCase.ts:194` confirms this was never finished. Result: editing commission/fees/limits in the Ops form has **zero effect** on what customers are charged.

## Goal

Make the per-route `FlowDefinition` the **single source of truth** for quote pricing: `exchangeFeePct`, `fixedFee`, `minAmount`, and `maxAmount`. Editing the Ops form must change what new quotes charge and enforce.

## Decisions (locked during brainstorming)

1. **Fee meaning — replace.** The route's `exchangeFeePct` / `fixedFee` *replace* the hardcoded provider constants. The flow definition becomes the authoritative spread + fixed fee per route.
2. **Missing/disabled definition — reject.** If a quote is requested for a corridor with no `FlowDefinition`, or one with `enabled === false`, the quote is **rejected** with a clear error. Flow definitions become mandatory for pricing.
3. **Scope — fees + limits.** Wire up `exchangeFeePct`, `fixedFee`, **and** `minAmount` / `maxAmount`. The entire pricing/limits section of the form becomes authoritative.
4. **Blank limit — no limit.** A `null` `minAmount` means no minimum; a `null` `maxAmount` means no maximum. The route fully owns its limits.

## Architecture

Approach: a **corridor-pricing port owned by the `quotes` module**, backed by a thin adapter over the `flows` module. This keeps `QuoteUseCase` depending only on an interface in its own module, mirroring the existing `IPaymentServiceFactory` / `IExchangeProviderFactory` DI pattern.

A corridor's identity is its unique key on `FlowDefinition`: `@@unique([cryptoCurrency, blockchain, targetCurrency])` ([prisma/schema.prisma:382](../../../abroad-server/prisma/schema.prisma)). The quote already receives all three (`cryptoCurrency`, `network` = blockchain, `targetCurrency`), so matching is a single lookup.

### New components

**1. Domain error** — `quotes/application/errors/CorridorNotConfiguredError.ts`
```ts
class CorridorNotConfiguredError extends Error {
  // message e.g. "No active flow definition for corridor USDC/STELLAR → COP"
}
```
Maps automatically to `400 { reason }` via the controller's existing catch ([QuoteController.ts:163-166](../../../abroad-server/src/modules/quotes/interfaces/http/QuoteController.ts)) — **no controller change**.

**2. Port (owned by `quotes`)** — `quotes/application/contracts/ICorridorPricingProvider.ts`
```ts
interface CorridorPricing {
  exchangeFeePct: number
  fixedFee: number
  minAmount: number | null   // null = no minimum
  maxAmount: number | null   // null = no maximum
}
interface ICorridorPricingProvider {
  getPricing(corridor: {
    cryptoCurrency: CryptoCurrency
    blockchain: BlockchainNetwork
    targetCurrency: TargetCurrency
  }): Promise<CorridorPricing>
  // throws CorridorNotConfiguredError when no enabled FlowDefinition matches
}
```

**3. Adapter (the one allowed `quotes → flows` seam; lives in `quotes/infrastructure`)** — `FlowCorridorPricingProvider.ts`. Implements the port; delegates to a new `FlowDefinitionService.findActiveByCorridor(corridor)` that queries the unique key filtered by `enabled: true`. A `null` result → adapter throws `CorridorNotConfiguredError`.

**4. DI** — add `TYPES.ICorridorPricingProvider`, bind it to `FlowCorridorPricingProvider`.

### Gate

Pricing keys on the `FlowDefinition` existing **and** `enabled === true`. The separate `FlowCorridor.status` (SUPPORTED/UNSUPPORTED) tracker is **not** consulted — one authoritative gate.

### Explicitly out of scope

The route's `pricingProvider` field does **not** change which exchange provider supplies the raw market rate; rate sourcing stays as-is (selected by target currency + blockchain capability in `ExchangeProviderFactory`). We only replace the *fee* applied on top, plus `fixedFee` and limits. The now-unused provider members (`exchangePercentageFee`, `fixedFee`, `MIN/MAX_USER_AMOUNT_PER_TRANSACTION`) stay on their interfaces — removing them is out of scope.

## Pricing logic changes (`QuoteUseCase`)

`QuoteUseCase` gains one injected dependency (`ICorridorPricingProvider`). The exchange-rate fetch, partner resolution, and quote persistence are unchanged.

**`createQuote` — new order (fail fast before any network call):**
```
targetAmount   = normalizeTargetAmount(amount)
pricing        = await corridorPricing.getPricing({ cryptoCurrency, blockchain: network, targetCurrency })  // NEW
exchangeRate   = await provider.getExchangeRate(...)                       // unchanged (raw market rate)
rateWithFee    = applyExchangeFee(exchangeRate, pricing.exchangeFeePct)    // was provider.exchangePercentageFee
paymentService = factory.getPaymentService(paymentMethod)
ensurePaymentServiceIsEnabled(paymentService, paymentMethod)              // KEEP — provider must be operational
ensureAmountWithinLimits(targetAmount, pricing, targetCurrency)           // was paymentService MIN/MAX
sourceAmount   = calculateSourceAmount(targetAmount, rateWithFee, pricing.fixedFee)  // was paymentService.fixedFee
```

**`createReverseQuote`** — same three swaps: `applyExchangeFee(..., pricing.exchangeFeePct)`, `calculateTargetAmount(..., pricing.fixedFee, ...)`, and `ensureAmountWithinLimits(targetAmount, pricing, targetCurrency)`. Pricing is looked up early here too.

**`ensureAmountWithinLimits`** — signature changes from `(amount, paymentService, targetCurrency)` to `(amount, limits: { minAmount: number | null, maxAmount: number | null }, targetCurrency)`. A `null` bound is skipped entirely; error messages still read in `targetCurrency`.

**Cleanup:** remove the `// TODO: Add percentage fee calculation when available` comment (now done).

## Rollout

Making flow definitions mandatory means **any corridor quotable today but lacking an enabled `FlowDefinition` will start failing**. Two parts, both required before the rejecting code goes live.

### Current effective pricing (the backfill target — economic neutrality on cutover)

Mirror the **real provider constants** (verified from code), not the UI defaults:

| Corridor type | exchangeFeePct | fixedFee | minAmount | maxAmount |
|---|---|---|---|---|
| **COP** (payout BREB, rate via Binance) | 0.0085 | 0 | 5,000 | 5,000,000 |
| **BRL** (payout PIX, rate via Transfero) | 0.001 | 0 | null (0 today) | null (∞ today) |

Sources: `brebPaymentService` (`MIN 5_000`, `MAX 5_000_000`, `fixedFee 0`); `transferoPaymentService` (`MIN 0`, `MAX +Infinity`, `fixedFee 0`); `binanceExchangeProvider.exchangePercentageFee 0.0085`; `transferoExchangeProvider.exchangePercentageFee 0.001`.

### 1. Pre-deploy audit (read-only safety gate)

A script that enumerates the corridors quotable today and reports any lacking an enabled `FlowDefinition`. **Go/no-go check: must return an empty list before deploy.** Kept regardless of backfill mechanism — with manual entry it's the only guard against a typo or omission.

### 2. Backfill — manual via the Ops form

The Ops team enters each live corridor's pricing through the existing "Corridor Flow Builder" form before deploy, using the table above. Repeated per environment (dev/staging/prod).

### Deploy sequence

1. Ops fills in all live corridors via the form.
2. Run the audit script → confirm empty "would-break" list.
3. Deploy the `QuoteUseCase` change.
4. After cutover, Ops edits take immediate effect on new quotes.

## Testing (TDD — tests before implementation)

**`QuoteUseCase` unit tests** (inject a *fake* `ICorridorPricingProvider`, no DB):
- Forward quote uses `pricing.exchangeFeePct` + `pricing.fixedFee` — assert `sourceAmount` reflects the route's fee, not the old provider constant.
- Reverse quote applies the same fee + `fixedFee` to `targetAmount`.
- Limits: `< minAmount` rejected; `> maxAmount` rejected; `null` min/max → no enforcement.
- Unconfigured corridor: fake throws `CorridorNotConfiguredError` → propagates out of both quote methods.
- Fail-fast: the exchange-rate provider is **not** called when the corridor is unconfigured.

**Adapter test** — `FlowCorridorPricingProvider`: a `FlowDefinitionService` hit maps → `CorridorPricing`; a miss/disabled (`null`) → throws `CorridorNotConfiguredError`.

**Repository test** — `FlowDefinitionService.findActiveByCorridor`: returns the enabled match on the unique key; returns `null` when absent **or** when the row exists but `enabled === false`.

**Existing quote tests** — any that assume provider-fee math are updated to supply the pricing provider (expected, flagged here).

**Audit script** — light smoke test only (one-off ops tool).

## Files touched (anticipated)

- `abroad-server/src/modules/quotes/application/quoteUseCase.ts` (logic swap + new dependency)
- `abroad-server/src/modules/quotes/application/contracts/ICorridorPricingProvider.ts` (new)
- `abroad-server/src/modules/quotes/application/errors/CorridorNotConfiguredError.ts` (new)
- `abroad-server/src/modules/quotes/infrastructure/FlowCorridorPricingProvider.ts` (new adapter)
- `abroad-server/src/modules/flows/application/FlowDefinitionService.ts` (new `findActiveByCorridor`)
- `abroad-server/src/app/container/types.ts` + container bindings (DI)
- audit script (new, read-only)
- tests (new + updates)
