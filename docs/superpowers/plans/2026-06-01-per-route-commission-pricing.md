# Per-Route Commission Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ops "Corridor Flow Builder" form authoritative for quote pricing — the per-route `FlowDefinition` (`exchangeFeePct`, `fixedFee`, `minAmount`, `maxAmount`) drives quote math, and quotes for unconfigured corridors are rejected.

**Architecture:** Introduce an `ICorridorPricingProvider` port owned by the `quotes` module, backed by a `FlowCorridorPricingProvider` adapter that reads the enabled `FlowDefinition` for the corridor via a new `FlowDefinitionService.findActiveByCorridor`. `QuoteUseCase` consumes the port (instead of hardcoded provider fee/limit constants) and throws `CorridorNotConfiguredError` (→ 400 via the controller's existing catch) when no enabled definition exists.

**Tech Stack:** TypeScript, Node, Inversify (DI), Prisma, Jest, tsx (scripts). All paths below are under `abroad-server/`.

---

## Design reference

Spec: [docs/superpowers/specs/2026-06-01-per-route-commission-pricing-design.md](../specs/2026-06-01-per-route-commission-pricing-design.md)

## Decisions (locked)

1. Route `exchangeFeePct`/`fixedFee` **replace** the hardcoded provider constants.
2. No enabled `FlowDefinition` for the corridor → **reject** the quote.
3. Scope = fees **+ min/max limits**.
4. Blank (`null`) limit = **no limit**.
5. Gate keys on `FlowDefinition` existing **and** `enabled === true` (not `FlowCorridor.status`).
6. `pricingProvider` does **not** change rate sourcing — only the fee on top changes (out of scope).

## File structure

**New files**
- `src/modules/quotes/application/contracts/ICorridorPricingProvider.ts` — port + `CorridorPricing` + `CorridorIdentifier` types.
- `src/modules/quotes/application/errors/CorridorNotConfiguredError.ts` — domain error.
- `src/modules/quotes/infrastructure/FlowCorridorPricingProvider.ts` — adapter (the one `quotes → flows` seam).
- `src/modules/flows/application/corridorPricingAudit.ts` — pure `findCorridorsMissingPricing` helper (testable).
- `scripts/auditCorridorPricing.ts` — thin runner (PrismaClient + logging) around the helper.
- Tests: `src/tests/modules/quotes/application/errors/CorridorNotConfiguredError.test.ts`, `src/tests/modules/quotes/infrastructure/FlowCorridorPricingProvider.test.ts`, `src/tests/modules/flows/application/FlowDefinitionService.findActiveByCorridor.test.ts`, `src/tests/modules/flows/application/corridorPricingAudit.test.ts`.

**Modified files**
- `src/app/container/types.ts` — add `ICorridorPricingProvider` symbol.
- `src/app/container/domainBindings.ts` — bind the adapter.
- `src/modules/flows/application/FlowDefinitionService.ts` — add `findActiveByCorridor`.
- `src/modules/quotes/application/quoteUseCase.ts` — inject port; swap fee/limit logic.
- `src/tests/modules/quotes/application/quoteUseCase.test.ts` — update harness + expectations + new tests.

---

## Task 1: Corridor pricing port (types only)

**Files:**
- Create: `src/modules/quotes/application/contracts/ICorridorPricingProvider.ts`

No test — this file is pure type/interface declarations with no runtime behavior.

- [ ] **Step 1: Create the port file**

```ts
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

export interface CorridorIdentifier {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  targetCurrency: TargetCurrency
}

export interface CorridorPricing {
  exchangeFeePct: number
  fixedFee: number
  maxAmount: null | number
  minAmount: null | number
}

export interface ICorridorPricingProvider {
  getPricing(corridor: CorridorIdentifier): Promise<CorridorPricing>
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/modules/quotes/application/contracts/ICorridorPricingProvider.ts
git commit -m "feat(quotes): add ICorridorPricingProvider port"
```

---

## Task 2: CorridorNotConfiguredError

**Files:**
- Create: `src/modules/quotes/application/errors/CorridorNotConfiguredError.ts`
- Test: `src/tests/modules/quotes/application/errors/CorridorNotConfiguredError.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import { CorridorNotConfiguredError } from '../../../../../modules/quotes/application/errors/CorridorNotConfiguredError'

describe('CorridorNotConfiguredError', () => {
  it('builds a descriptive message and name from the corridor', () => {
    const error = new CorridorNotConfiguredError({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.COP,
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('CorridorNotConfiguredError')
    expect(error.message).toBe('No active flow definition for corridor USDC/STELLAR → COP')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/tests/modules/quotes/application/errors/CorridorNotConfiguredError.test.ts`
Expected: FAIL — cannot find module `CorridorNotConfiguredError`.

- [ ] **Step 3: Implement the error class**

```ts
import { CorridorIdentifier } from '../contracts/ICorridorPricingProvider'

export class CorridorNotConfiguredError extends Error {
  constructor(corridor: CorridorIdentifier) {
    super(
      `No active flow definition for corridor ${corridor.cryptoCurrency}/${corridor.blockchain} → ${corridor.targetCurrency}`,
    )
    this.name = 'CorridorNotConfiguredError'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/tests/modules/quotes/application/errors/CorridorNotConfiguredError.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/quotes/application/errors/CorridorNotConfiguredError.ts src/tests/modules/quotes/application/errors/CorridorNotConfiguredError.test.ts
git commit -m "feat(quotes): add CorridorNotConfiguredError"
```

---

## Task 3: Register the DI type symbol

**Files:**
- Modify: `src/app/container/types.ts:2-46` (the `typeKeys` array)

No test — adding a symbol key; verified by typecheck.

- [ ] **Step 1: Add the symbol key**

In `src/app/container/types.ts`, add `'ICorridorPricingProvider',` to the `typeKeys` array, alphabetically near the other `I*` keys (e.g. immediately after `'IExchangeProviderFactory',` on line 15):

```ts
  'IExchangeProviderFactory',
  'ICorridorPricingProvider',
  'IKycService',
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/container/types.ts
git commit -m "chore(di): add ICorridorPricingProvider type symbol"
```

---

## Task 4: FlowDefinitionService.findActiveByCorridor

**Files:**
- Modify: `src/modules/flows/application/FlowDefinitionService.ts` (add a public method after `update`, before the private helpers around line 119)
- Test: `src/tests/modules/flows/application/FlowDefinitionService.findActiveByCorridor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { FlowDefinitionBuilder } from '../../../../modules/flows/application/FlowDefinitionBuilder'
import { FlowDefinitionService } from '../../../../modules/flows/application/FlowDefinitionService'

const corridor = {
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  targetCurrency: TargetCurrency.COP,
}

const buildRow = () => ({
  blockchain: BlockchainNetwork.STELLAR,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  cryptoCurrency: CryptoCurrency.USDC,
  enabled: true,
  exchangeFeePct: 0.0085,
  fixedFee: 0,
  id: 'def-1',
  maxAmount: 5_000_000,
  minAmount: 5_000,
  name: 'USDC Stellar → COP',
  payoutProvider: 'BREB',
  pricingProvider: 'BINANCE',
  targetCurrency: TargetCurrency.COP,
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  userSteps: [],
})

describe('FlowDefinitionService.findActiveByCorridor', () => {
  const findFirst = jest.fn()
  const prisma = { flowDefinition: { findFirst } }
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const service = new FlowDefinitionService(dbProvider, {} as unknown as FlowDefinitionBuilder)

  beforeEach(() => {
    findFirst.mockReset()
  })

  it('returns the mapped definition when an enabled row exists', async () => {
    findFirst.mockResolvedValue(buildRow())

    const result = await service.findActiveByCorridor(corridor)

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        enabled: true,
        targetCurrency: TargetCurrency.COP,
      },
    })
    expect(result).toMatchObject({
      exchangeFeePct: 0.0085,
      fixedFee: 0,
      maxAmount: 5_000_000,
      minAmount: 5_000,
    })
  })

  it('returns null when no enabled row matches', async () => {
    findFirst.mockResolvedValue(null)

    const result = await service.findActiveByCorridor(corridor)

    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/tests/modules/flows/application/FlowDefinitionService.findActiveByCorridor.test.ts`
Expected: FAIL — `service.findActiveByCorridor is not a function`.

- [ ] **Step 3: Implement the method**

In `src/modules/flows/application/FlowDefinitionService.ts`, add this public method immediately after the `update(...)` method closes (after line 119, before `private buildSystemSteps`):

```ts
  public async findActiveByCorridor(corridor: {
    blockchain: FlowDefinitionDto['blockchain']
    cryptoCurrency: FlowDefinitionDto['cryptoCurrency']
    targetCurrency: FlowDefinitionDto['targetCurrency']
  }): Promise<FlowDefinitionDto | null> {
    const client = await this.dbProvider.getClient()
    const definition = await client.flowDefinition.findFirst({
      where: {
        blockchain: corridor.blockchain,
        cryptoCurrency: corridor.cryptoCurrency,
        enabled: true,
        targetCurrency: corridor.targetCurrency,
      },
    })

    return definition ? this.toDto(definition) : null
  }
```

(`FlowDefinitionDto` is already imported at the top of the file; no new imports needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/tests/modules/flows/application/FlowDefinitionService.findActiveByCorridor.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/flows/application/FlowDefinitionService.ts src/tests/modules/flows/application/FlowDefinitionService.findActiveByCorridor.test.ts
git commit -m "feat(flows): add FlowDefinitionService.findActiveByCorridor"
```

---

## Task 5: FlowCorridorPricingProvider adapter

**Files:**
- Create: `src/modules/quotes/infrastructure/FlowCorridorPricingProvider.ts`
- Test: `src/tests/modules/quotes/infrastructure/FlowCorridorPricingProvider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import type { FlowDefinitionService } from '../../../../modules/flows/application/FlowDefinitionService'

import { CorridorNotConfiguredError } from '../../../../modules/quotes/application/errors/CorridorNotConfiguredError'
import { FlowCorridorPricingProvider } from '../../../../modules/quotes/infrastructure/FlowCorridorPricingProvider'

const corridor = {
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  targetCurrency: TargetCurrency.COP,
}

describe('FlowCorridorPricingProvider', () => {
  const findActiveByCorridor = jest.fn()
  const flowDefinitionService = { findActiveByCorridor } as unknown as FlowDefinitionService
  const provider = new FlowCorridorPricingProvider(flowDefinitionService)

  beforeEach(() => {
    findActiveByCorridor.mockReset()
  })

  it('maps an enabled definition to corridor pricing', async () => {
    findActiveByCorridor.mockResolvedValue({
      exchangeFeePct: 0.0085,
      fixedFee: 0,
      maxAmount: 5_000_000,
      minAmount: 5_000,
    })

    const pricing = await provider.getPricing(corridor)

    expect(findActiveByCorridor).toHaveBeenCalledWith(corridor)
    expect(pricing).toEqual({
      exchangeFeePct: 0.0085,
      fixedFee: 0,
      maxAmount: 5_000_000,
      minAmount: 5_000,
    })
  })

  it('throws CorridorNotConfiguredError when no enabled definition exists', async () => {
    findActiveByCorridor.mockResolvedValue(null)

    await expect(provider.getPricing(corridor)).rejects.toThrow(CorridorNotConfiguredError)
    await expect(provider.getPricing(corridor)).rejects.toThrow(
      'No active flow definition for corridor USDC/STELLAR → COP',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/tests/modules/quotes/infrastructure/FlowCorridorPricingProvider.test.ts`
Expected: FAIL — cannot find module `FlowCorridorPricingProvider`.

- [ ] **Step 3: Implement the adapter**

```ts
import { inject, injectable } from 'inversify'

import { FlowDefinitionService } from '../../flows/application/FlowDefinitionService'
import {
  CorridorIdentifier,
  CorridorPricing,
  ICorridorPricingProvider,
} from '../application/contracts/ICorridorPricingProvider'
import { CorridorNotConfiguredError } from '../application/errors/CorridorNotConfiguredError'

@injectable()
export class FlowCorridorPricingProvider implements ICorridorPricingProvider {
  constructor(
    @inject(FlowDefinitionService)
    private readonly flowDefinitionService: FlowDefinitionService,
  ) {}

  public async getPricing(corridor: CorridorIdentifier): Promise<CorridorPricing> {
    const definition = await this.flowDefinitionService.findActiveByCorridor(corridor)
    if (!definition) {
      throw new CorridorNotConfiguredError(corridor)
    }

    return {
      exchangeFeePct: definition.exchangeFeePct,
      fixedFee: definition.fixedFee,
      maxAmount: definition.maxAmount,
      minAmount: definition.minAmount,
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/tests/modules/quotes/infrastructure/FlowCorridorPricingProvider.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/quotes/infrastructure/FlowCorridorPricingProvider.ts src/tests/modules/quotes/infrastructure/FlowCorridorPricingProvider.test.ts
git commit -m "feat(quotes): add FlowCorridorPricingProvider adapter"
```

---

## Task 6: Bind the adapter in the container

**Files:**
- Modify: `src/app/container/domainBindings.ts` (imports near line 37; binding array near line 62)

No unit test — DI registration; verified by typecheck and the full suite.

- [ ] **Step 1: Add the import**

In `src/app/container/domainBindings.ts`, add near the other `quotes` import (the `QuoteUseCase` import is on line 37):

```ts
import { FlowCorridorPricingProvider } from '../../modules/quotes/infrastructure/FlowCorridorPricingProvider'
```

- [ ] **Step 2: Add the binding**

In the `domainBindings` array, add immediately after the `QuoteUseCase` entry (line 62):

```ts
  { identifier: TYPES.QuoteUseCase, implementation: QuoteUseCase },
  { identifier: TYPES.ICorridorPricingProvider, implementation: FlowCorridorPricingProvider },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/container/domainBindings.ts
git commit -m "chore(di): bind FlowCorridorPricingProvider"
```

---

## Task 7: Wire corridor pricing into QuoteUseCase

**Files:**
- Modify: `src/modules/quotes/application/quoteUseCase.ts` (imports, constructor, `createQuote`, `createReverseQuote`, `ensureAmountWithinLimits`)
- Test: `src/tests/modules/quotes/application/quoteUseCase.test.ts`

This task changes `QuoteUseCase`'s constructor (adds a 5th dependency), so the test harness must be updated first. Do tests first (red), then implementation (green).

- [ ] **Step 1: Update the test harness (add the pricing fake + constructor arg)**

In `src/tests/modules/quotes/application/quoteUseCase.test.ts`:

Add imports (after the existing `import type` block near line 14):

```ts
import type { CorridorPricing, ICorridorPricingProvider } from '../../../../modules/quotes/application/contracts/ICorridorPricingProvider'

import { CorridorNotConfiguredError } from '../../../../modules/quotes/application/errors/CorridorNotConfiguredError'
```

Add a builder after `buildPaymentService` (after line 34):

```ts
const buildCorridorPricing = (overrides?: Partial<CorridorPricing>): CorridorPricing => ({
  exchangeFeePct: 0.01,
  fixedFee: 1,
  maxAmount: null,
  minAmount: null,
  ...(overrides ?? {}),
})
```

Declare the field with the other `let` declarations (after line 41 `let quoteUseCase: QuoteUseCase`):

```ts
  let corridorPricingProvider: ICorridorPricingProvider
```

In `beforeEach`, build the fake and pass it as the 5th constructor argument. Replace the existing construction line (line 74):

```ts
    corridorPricingProvider = {
      getPricing: jest.fn(async () => buildCorridorPricing()),
    }
    quoteUseCase = new QuoteUseCase(dbProvider, paymentServiceFactory, exchangeProviderFactory, secretManager, corridorPricingProvider)
```

- [ ] **Step 2: Migrate the limit tests to corridor pricing**

The limit source moved from the payment service to corridor pricing. Replace the two limit tests.

Replace `it('enforces max amount per transaction', ...)` (lines 117-128) with:

```ts
  it('enforces max amount per transaction', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(buildCorridorPricing({ maxAmount: 50 }))

    await expect(quoteUseCase.createQuote({
      amount: 100,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('The maximum allowed amount for COP is 50 COP')
  })
```

Replace `it('enforces minimum amount per transaction', ...)` (lines 130-141) with:

```ts
  it('enforces minimum amount per transaction', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(buildCorridorPricing({ minAmount: 5_000 }))

    await expect(quoteUseCase.createQuote({
      amount: 4_999,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('The minimum allowed amount for COP is 5000 COP')
  })
```

In `it('creates reverse quotes and validates max amount', ...)` (lines 155-182), replace the restrictive-service block (lines 172-181) with a pricing override:

```ts
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(buildCorridorPricing({ maxAmount: 1 }))

    await expect(quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 50,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('The maximum allowed amount for COP is 1 COP')
```

- [ ] **Step 3: Migrate the fee-driven reverse precision test**

The fee now comes from corridor pricing, not the payment service / exchange provider. Replace `it('drops fractional digits from COP reverse quotes', ...)` (lines 227-255) with:

```ts
  it('drops fractional digits from COP reverse quotes', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(
      buildCorridorPricing({ exchangeFeePct: 0, fixedFee: 0 }),
    )
    ;(exchangeProviderFactory.getExchangeProvider as jest.Mock).mockReturnValue({
      createMarketOrder: jest.fn(),
      exchangePercentageFee: 0,
      getExchangeAddress: jest.fn(),
      getExchangeRate: jest.fn(async () => 3.789),
    })
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({
      id: 'reverse-precision',
      ...data,
    }))

    const result = await quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 12.34,
      targetCurrency: TargetCurrency.COP,
    })

    expect(prisma.quote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetAmount: 3,
      }),
    })
    expect(result.value).toBe(3)
  })
```

- [ ] **Step 4: Add new tests for the corridor-pricing behavior**

Add these tests inside the `describe('QuoteUseCase', ...)` block (e.g. just before the final closing `})`):

```ts
  it('prices using corridor exchangeFeePct and fixedFee, not provider constants', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(
      buildCorridorPricing({ exchangeFeePct: 0.1, fixedFee: 5 }),
    )
    // Clean rate so the expected value is exact (no float-rounding boundary).
    ;(exchangeProviderFactory.getExchangeProvider as jest.Mock).mockReturnValue({
      createMarketOrder: jest.fn(),
      exchangePercentageFee: 0.01, // must be ignored in favor of the corridor's 0.1
      getExchangeAddress: jest.fn(),
      getExchangeRate: jest.fn(async () => 2),
    })
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({ id: 'priced', ...data }))

    const result = await quoteUseCase.createQuote({
      amount: 100,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partner,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })

    expect(corridorPricingProvider.getPricing).toHaveBeenCalledWith({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.COP,
    })
    // rate 2 * (1 + 0.1) = 2.2 ; (100 + 5) * 2.2 = 231 exactly.
    // If the provider's 0.01 fee were used instead, the value would be 212.1.
    expect(result.value).toBe(231)
  })

  it('rejects quotes for corridors without an active flow definition (fail-fast)', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockRejectedValue(
      new CorridorNotConfiguredError({
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.COP,
      }),
    )

    await expect(quoteUseCase.createQuote({
      amount: 100,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('No active flow definition for corridor USDC/STELLAR → COP')

    expect(exchangeProviderFactory.getExchangeProvider).not.toHaveBeenCalled()
  })

  it('rejects reverse quotes for corridors without an active flow definition', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockRejectedValue(
      new CorridorNotConfiguredError({
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.COP,
      }),
    )

    await expect(quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 50,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow(CorridorNotConfiguredError)
  })

  it('applies no limit when corridor min/max are null', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(
      buildCorridorPricing({ maxAmount: null, minAmount: null }),
    )
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({ id: 'no-limit', ...data }))

    const result = await quoteUseCase.createQuote({
      amount: 999_999_999,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partner,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })

    expect(result.quote_id).toBe('no-limit')
  })
```

- [ ] **Step 5: Run the test file to verify the new/changed tests fail**

Run: `npx jest src/tests/modules/quotes/application/quoteUseCase.test.ts`
Expected: FAIL — `QuoteUseCase` constructor still takes 4 args / still reads provider fee+limits, so the new pricing assertions and `getPricing` calls fail.

- [ ] **Step 6: Update QuoteUseCase imports**

In `src/modules/quotes/application/quoteUseCase.ts`, add after the existing contract imports (after line 17):

```ts
import { ICorridorPricingProvider } from './contracts/ICorridorPricingProvider'
```

- [ ] **Step 7: Add the constructor dependency**

In the constructor (lines 56-64), add the 5th injected parameter after `secretManager`:

```ts
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ICorridorPricingProvider)
    private corridorPricingProvider: ICorridorPricingProvider,
  ) { }
```

- [ ] **Step 8: Rewrite createQuote to use corridor pricing**

Replace the body of `createQuote` from the start of the method (line 66) through the `const sourceAmount = ...` line (line 87) with:

```ts
  public async createQuote(params: CreateQuoteParams): Promise<QuoteResponse> {
    const { amount, cryptoCurrency, network, partner, paymentMethod, targetCurrency } = params

    const targetAmount = this.normalizeTargetAmount(amount, targetCurrency)
    const expirationDate = this.getExpirationDate()

    const pricing = await this.corridorPricingProvider.getPricing({
      blockchain: network,
      cryptoCurrency,
      targetCurrency,
    })

    const exchangeRateProvider = this.exchangeProviderFactory.getExchangeProviderForCapability?.({
      targetCurrency,
    }) ?? this.exchangeProviderFactory.getExchangeProvider(targetCurrency)
    const exchangeRate = await exchangeRateProvider.getExchangeRate({
      sourceCurrency: cryptoCurrency, targetAmount, targetCurrency,
    })
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new Error('Invalid exchange rate received')
    }
    const exchangeRateWithFee = this.applyExchangeFee(exchangeRate, pricing.exchangeFeePct)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
    this.ensurePaymentServiceIsEnabled(paymentService, paymentMethod)

    this.ensureAmountWithinLimits(targetAmount, pricing, targetCurrency)

    const sourceAmount = this.calculateSourceAmount(targetAmount, exchangeRateWithFee, pricing.fixedFee)
```

(The remainder of `createQuote` — partner resolution and `prisma.quote.create` — is unchanged.)

- [ ] **Step 9: Rewrite createReverseQuote to use corridor pricing**

Replace `createReverseQuote` from the start of the method (line 128) through the `this.ensureAmountWithinLimits(...)` line (line 150) with:

```ts
  public async createReverseQuote(params: CreateReverseQuoteParams): Promise<QuoteResponse> {
    const { cryptoCurrency, network, partner, paymentMethod, sourceAmountInput, targetCurrency } = params

    const expirationDate = this.getExpirationDate()

    const pricing = await this.corridorPricingProvider.getPricing({
      blockchain: network,
      cryptoCurrency,
      targetCurrency,
    })

    const exchangeRateProvider = this.exchangeProviderFactory.getExchangeProviderForCapability?.({
      targetCurrency,
    }) ?? this.exchangeProviderFactory.getExchangeProvider(targetCurrency)
    const exchangeRate = await exchangeRateProvider.getExchangeRate({ sourceAmount: sourceAmountInput, sourceCurrency: cryptoCurrency, targetCurrency })
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new Error('Invalid exchange rate received')
    }
    const exchangeRateWithFee = this.applyExchangeFee(exchangeRate, pricing.exchangeFeePct)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
    this.ensurePaymentServiceIsEnabled(paymentService, paymentMethod)
    const targetAmount = this.calculateTargetAmount(
      sourceAmountInput,
      exchangeRateWithFee,
      pricing.fixedFee,
      targetCurrency,
    )

    this.ensureAmountWithinLimits(targetAmount, pricing, targetCurrency)
```

(The remainder of `createReverseQuote` — partner resolution and `prisma.quote.create` — is unchanged.)

- [ ] **Step 10: Replace ensureAmountWithinLimits and drop the stale TODO**

Replace `ensureAmountWithinLimits` (lines 211-219) with the limits-object signature that skips `null` bounds:

```ts
  private ensureAmountWithinLimits(
    amount: number,
    limits: { maxAmount: null | number, minAmount: null | number },
    targetCurrency: TargetCurrency,
  ): void {
    if (limits.minAmount !== null && amount < limits.minAmount) {
      throw new Error(`The minimum allowed amount for ${targetCurrency} is ${limits.minAmount} ${targetCurrency}`)
    }

    if (limits.maxAmount !== null && amount > limits.maxAmount) {
      throw new Error(`The maximum allowed amount for ${targetCurrency} is ${limits.maxAmount} ${targetCurrency}`)
    }
  }
```

Remove the now-stale comment above `calculateSourceAmount` (line 194):

```ts
  // TODO: Add percentage fee calculation when available
```

(Delete that single comment line. The `IPaymentService` import on line 14 is still used by `buildPaymentService` callers and `ensurePaymentServiceIsEnabled`, so leave it.)

- [ ] **Step 11: Run the test file to verify it passes**

Run: `npx jest src/tests/modules/quotes/application/quoteUseCase.test.ts`
Expected: PASS (all tests, including the migrated and new ones).

- [ ] **Step 12: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/modules/quotes/application/quoteUseCase.ts src/tests/modules/quotes/application/quoteUseCase.test.ts
git commit -m "feat(quotes): price quotes from per-route flow definition fees and limits"
```

---

## Task 8: Corridor pricing readiness audit

**Files:**
- Create: `src/modules/flows/application/corridorPricingAudit.ts` (pure helper)
- Create: `scripts/auditCorridorPricing.ts` (thin runner)
- Test: `src/tests/modules/flows/application/corridorPricingAudit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import { findCorridorsMissingPricing } from '../../../../modules/flows/application/corridorPricingAudit'

const corridor = (targetCurrency: TargetCurrency) => ({
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  targetCurrency,
})

describe('findCorridorsMissingPricing', () => {
  it('returns labels for SUPPORTED corridors lacking an enabled definition', async () => {
    const prisma = {
      flowCorridor: {
        findMany: jest.fn(async () => [corridor(TargetCurrency.COP), corridor(TargetCurrency.BRL)]),
      },
      flowDefinition: {
        findFirst: jest.fn(async ({ where }: { where: { targetCurrency: TargetCurrency } }) =>
          where.targetCurrency === TargetCurrency.COP ? { id: 'def-cop' } : null),
      },
    }

    const missing = await findCorridorsMissingPricing(prisma)

    expect(prisma.flowCorridor.findMany).toHaveBeenCalledWith({ where: { status: 'SUPPORTED' } })
    expect(missing).toEqual(['USDC/STELLAR → BRL'])
  })

  it('returns an empty list when every SUPPORTED corridor has an enabled definition', async () => {
    const prisma = {
      flowCorridor: { findMany: jest.fn(async () => [corridor(TargetCurrency.COP)]) },
      flowDefinition: { findFirst: jest.fn(async () => ({ id: 'def-cop' })) },
    }

    const missing = await findCorridorsMissingPricing(prisma)

    expect(missing).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/tests/modules/flows/application/corridorPricingAudit.test.ts`
Expected: FAIL — cannot find module `corridorPricingAudit`.

- [ ] **Step 3: Implement the pure helper**

Create `src/modules/flows/application/corridorPricingAudit.ts`:

```ts
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

interface CorridorRow {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  targetCurrency: TargetCurrency
}

export interface CorridorAuditClient {
  flowCorridor: {
    findMany(args: { where: { status: 'SUPPORTED' } }): Promise<CorridorRow[]>
  }
  flowDefinition: {
    findFirst(args: {
      where: {
        blockchain: BlockchainNetwork
        cryptoCurrency: CryptoCurrency
        enabled: true
        targetCurrency: TargetCurrency
      }
    }): Promise<unknown>
  }
}

export async function findCorridorsMissingPricing(client: CorridorAuditClient): Promise<string[]> {
  const corridors = await client.flowCorridor.findMany({ where: { status: 'SUPPORTED' } })
  const missing: string[] = []

  for (const corridor of corridors) {
    const definition = await client.flowDefinition.findFirst({
      where: {
        blockchain: corridor.blockchain,
        cryptoCurrency: corridor.cryptoCurrency,
        enabled: true,
        targetCurrency: corridor.targetCurrency,
      },
    })

    if (!definition) {
      missing.push(`${corridor.cryptoCurrency}/${corridor.blockchain} → ${corridor.targetCurrency}`)
    }
  }

  return missing
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/tests/modules/flows/application/corridorPricingAudit.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Create the runner script**

Create `scripts/auditCorridorPricing.ts`:

```ts
// scripts/auditCorridorPricing.ts
import { PrismaClient } from '@prisma/client'

import { CorridorAuditClient, findCorridorsMissingPricing } from '../src/modules/flows/application/corridorPricingAudit'

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  try {
    const missing = await findCorridorsMissingPricing(prisma as unknown as CorridorAuditClient)
    if (missing.length === 0) {
      console.log('✅ All SUPPORTED corridors have an enabled flow definition.')
      return
    }

    console.error(`❌ ${missing.length} SUPPORTED corridor(s) missing an enabled flow definition:`)
    for (const label of missing) {
      console.error(`  - ${label}`)
    }
    process.exitCode = 1
  }
  finally {
    await prisma.$disconnect()
  }
}

void main()
```

- [ ] **Step 6: Verify the script runs (manual, against a reachable DB)**

Run: `npx tsx scripts/auditCorridorPricing.ts`
Expected: prints either the ✅ line or the ❌ list. (This is the pre-deploy go/no-go gate; a non-zero exit means corridors still need pricing entered via the Ops form.)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/flows/application/corridorPricingAudit.ts src/tests/modules/flows/application/corridorPricingAudit.test.ts scripts/auditCorridorPricing.ts
git commit -m "feat(flows): add corridor pricing readiness audit script"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green, including `quoteUseCase`, `FlowCorridorPricingProvider`, `FlowDefinitionService.findActiveByCorridor`, `corridorPricingAudit`, `CorridorNotConfiguredError`, and the existing `QuoteController` suite.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (no errors). If import-order errors appear, run `npm run format` and re-commit.

- [ ] **Step 4: Final commit (if lint produced fixes)**

```bash
git add -A
git commit -m "chore(quotes): lint fixes for per-route commission pricing"
```

---

## Rollout (manual, performed by the operator — not a code task)

Before deploying the code from Task 7 to an environment:

1. **Enter pricing for every live corridor** via the Ops "Corridor Flow Builder" form, mirroring today's effective values:
   - **COP** (payout BREB, rate via Binance): exchangeFeePct `0.0085`, fixedFee `0`, minAmount `5000`, maxAmount `5000000`.
   - **BRL** (payout PIX, rate via Transfero): exchangeFeePct `0.001`, fixedFee `0`, minAmount blank, maxAmount blank.
2. **Run the audit:** `npx tsx scripts/auditCorridorPricing.ts` → must print the ✅ line (exit 0).
3. **Deploy** the `QuoteUseCase` change.
4. After cutover, Ops edits take effect on new quotes immediately.

Repeat steps 1-2 per environment (dev / staging / prod).

---

## Self-review notes

- **Spec coverage:** port (Task 1), error (Task 2), DI symbol (Task 3), `findActiveByCorridor` (Task 4), adapter (Task 5), binding (Task 6), `QuoteUseCase` fee+limit swap with fail-fast ordering (Task 7), audit (Task 8), verification (Task 9), rollout (manual section). All spec sections mapped.
- **`enabled` gate:** enforced in `findActiveByCorridor` (`enabled: true`) and re-used by the audit query. `FlowCorridor.status` is consulted only by the audit to enumerate intended-live corridors — never by pricing.
- **Type consistency:** `getPricing(corridor: CorridorIdentifier)` and `findActiveByCorridor(corridor: {blockchain, cryptoCurrency, targetCurrency})` use the same three corridor fields throughout; `CorridorPricing` fields (`exchangeFeePct`, `fixedFee`, `minAmount`, `maxAmount`) match `FlowDefinitionDto` and the `ensureAmountWithinLimits` limits object.
- **Out of scope:** `pricingProvider` rate sourcing unchanged; now-unused provider members (`exchangePercentageFee`, `fixedFee`, `MIN/MAX_USER_AMOUNT_PER_TRANSACTION`) left on their interfaces.
