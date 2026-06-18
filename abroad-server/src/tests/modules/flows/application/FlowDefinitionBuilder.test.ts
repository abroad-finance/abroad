import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowPricingProvider,
  FlowStepType,
  PaymentMethod,
  SupportedCurrency,
  TargetCurrency,
} from '@prisma/client'

import { FlowDefinitionBuilder } from '../../../../modules/flows/application/FlowDefinitionBuilder'

describe('FlowDefinitionBuilder Binance convert', () => {
  const makeBuilder = (isAsync = false) => {
    const paymentService = { isAsync }
    const paymentServiceFactory = {
      getPaymentService: jest.fn(() => paymentService),
      getPaymentServiceForCapability: jest.fn(() => paymentService),
    }
    return new FlowDefinitionBuilder(paymentServiceFactory as never)
  }

  const multiHopSteps = () => ([
    { type: 'PAYOUT' as const },
    { type: 'MOVE_TO_EXCHANGE' as const, venue: 'BINANCE' as const },
    { fromAsset: SupportedCurrency.USDT, toAsset: SupportedCurrency.USDC, type: 'CONVERT' as const, venue: 'BINANCE' as const },
    { asset: SupportedCurrency.USDC, fromVenue: 'BINANCE' as const, toVenue: 'TRANSFERO' as const, type: 'TRANSFER_VENUE' as const },
    { fromAsset: SupportedCurrency.USDC, toAsset: SupportedCurrency.BRL, type: 'CONVERT' as const, venue: 'TRANSFERO' as const },
  ])

  // Binance lists each pair in ONE direction only (e.g. USDCUSDT, never USDTUSDC).
  // The builder must not guess the symbol/side by string concatenation; it must
  // emit the conversion intent (fromAsset/toAsset) and let the executor resolve
  // the venue-specific symbol + side against live exchangeInfo.
  it('emits fromAsset/toAsset intent for a Binance convert instead of a guessed symbol/side', () => {
    const builder = makeBuilder()

    const steps = builder.build({
      blockchain: BlockchainNetwork.CELO,
      cryptoCurrency: CryptoCurrency.USDT,
      name: 'usdt-celo-brl',
      payoutProvider: PaymentMethod.PIX,
      pricingProvider: FlowPricingProvider.BINANCE,
      steps: [
        { type: 'PAYOUT' },
        { type: 'MOVE_TO_EXCHANGE', venue: 'BINANCE' },
        { fromAsset: SupportedCurrency.USDT, toAsset: SupportedCurrency.USDC, type: 'CONVERT', venue: 'BINANCE' },
      ],
      targetCurrency: TargetCurrency.BRL,
    })

    const convert = steps.find(step => step.stepType === FlowStepType.EXCHANGE_CONVERT)
    expect(convert?.config).toMatchObject({ fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' })
    expect(convert?.config).not.toHaveProperty('symbol')
    expect(convert?.config).not.toHaveProperty('side')
  })

  // CELO->BRL bridges through Binance, which has a 5-USDC per-withdrawal floor.
  // Small txs must still settle, so the corridor must NOT emit a per-flow
  // TREASURY_TRANSFER. Instead it settles by converting against the Transfero
  // float and records the owed Binance USDC as an ENQUEUE_BRIDGE leg for a
  // batched sweep. (USDT path: a Binance USDT->USDC convert precedes it.)
  it('routes a USDT/CELO->BRL bridge through convert-against-float + ENQUEUE_BRIDGE (no per-flow transfer)', () => {
    const builder = makeBuilder()

    const steps = builder.build({
      blockchain: BlockchainNetwork.CELO,
      cryptoCurrency: CryptoCurrency.USDT,
      name: 'usdt-celo-brl',
      payoutProvider: PaymentMethod.PIX,
      pricingProvider: FlowPricingProvider.BINANCE,
      steps: multiHopSteps(),
      targetCurrency: TargetCurrency.BRL,
    })

    expect(steps.find(s => s.stepType === FlowStepType.TREASURY_TRANSFER)).toBeUndefined()
    expect(steps.find(s => s.stepType === FlowStepType.AWAIT_EXCHANGE_BALANCE && s.config.provider === 'transfero')).toBeUndefined()

    const binanceConvert = steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'binance')
    const transferoConvert = steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'transfero')
    const enqueue = steps.find(s => s.stepType === FlowStepType.ENQUEUE_BRIDGE)

    expect(enqueue?.config).toMatchObject({ asset: 'USDC', destNetwork: 'SOL' })
    // ENQUEUE_BRIDGE is recorded BEFORE the float convert, so a convert failure
    // can never lose the accounting of USDC already on Binance.
    expect(enqueue?.stepOrder).toBeLessThan(transferoConvert?.stepOrder ?? 0)
    // Both the float convert and the bridge leg act on the realized Binance USDC
    // (the USDT->USDC convert's output), not the quoted USDT deposit.
    expect(transferoConvert?.config.amountSource).toEqual({ field: 'amount', kind: 'step', stepOrder: binanceConvert?.stepOrder })
    expect(enqueue?.config.amountSource).toEqual({ field: 'amount', kind: 'step', stepOrder: binanceConvert?.stepOrder })
  })

  // Pure USDC/CELO->BRL has no Binance convert: the USDC deposited at Binance IS
  // the quoted sourceAmount, so the float convert + bridge leg both default to it.
  it('routes a pure USDC/CELO->BRL bridge through float convert + ENQUEUE_BRIDGE (default amount)', () => {
    const builder = makeBuilder()

    const steps = builder.build({
      blockchain: BlockchainNetwork.CELO,
      cryptoCurrency: CryptoCurrency.USDC,
      name: 'usdc-celo-brl',
      payoutProvider: PaymentMethod.PIX,
      pricingProvider: FlowPricingProvider.TRANSFERO,
      steps: [
        { type: 'PAYOUT' },
        { type: 'MOVE_TO_EXCHANGE', venue: 'BINANCE' },
        { asset: SupportedCurrency.USDC, fromVenue: 'BINANCE', toVenue: 'TRANSFERO', type: 'TRANSFER_VENUE' },
        { fromAsset: SupportedCurrency.USDC, toAsset: SupportedCurrency.BRL, type: 'CONVERT', venue: 'TRANSFERO' },
      ],
      targetCurrency: TargetCurrency.BRL,
    })

    expect(steps.find(s => s.stepType === FlowStepType.TREASURY_TRANSFER)).toBeUndefined()
    expect(steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'binance')).toBeUndefined()

    const transferoConvert = steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'transfero')
    const enqueue = steps.find(s => s.stepType === FlowStepType.ENQUEUE_BRIDGE)

    expect(transferoConvert?.config).not.toHaveProperty('amountSource')
    expect(enqueue?.config).not.toHaveProperty('amountSource')
    expect(enqueue?.config).toMatchObject({ asset: 'USDC', destNetwork: 'SOL' })
  })

  // Async payout inserts AWAIT_PROVIDER_STATUS; absolute-order wiring must follow.
  it('keeps amountSource wiring correct under an async payout (order shift)', () => {
    const builder = makeBuilder(true)

    const steps = builder.build({
      blockchain: BlockchainNetwork.CELO,
      cryptoCurrency: CryptoCurrency.USDT,
      name: 'usdt-celo-brl-async',
      payoutProvider: PaymentMethod.PIX,
      pricingProvider: FlowPricingProvider.BINANCE,
      steps: multiHopSteps(),
      targetCurrency: TargetCurrency.BRL,
    })

    expect(steps.find(s => s.stepType === FlowStepType.AWAIT_PROVIDER_STATUS)?.stepOrder).toBe(2)
    const binanceConvert = steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'binance')
    const transferoConvert = steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'transfero')
    const enqueue = steps.find(s => s.stepType === FlowStepType.ENQUEUE_BRIDGE)
    // Absolute-order wiring survives the shift; leg recorded before the float convert.
    expect(enqueue?.config.amountSource).toEqual({ field: 'amount', kind: 'step', stepOrder: binanceConvert?.stepOrder })
    expect(enqueue?.stepOrder).toBeLessThan(transferoConvert?.stepOrder ?? 0)
  })
})
