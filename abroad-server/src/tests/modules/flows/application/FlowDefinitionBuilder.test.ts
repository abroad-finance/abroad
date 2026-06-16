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

  // Multi-hop must propagate the REALIZED amount between money-moving hops:
  // the post-convert TREASURY_TRANSFER must withdraw what the convert produced,
  // and the final Transfero convert must convert what the transfer delivered —
  // never the original quoted sourceAmount (which ignores spread + fees).
  it('wires amountSource so each hop consumes the prior step realized output', () => {
    const builder = makeBuilder()

    const steps = builder.build({
      blockchain: BlockchainNetwork.CELO,
      cryptoCurrency: CryptoCurrency.USDT,
      name: 'usdt-celo-brl-multihop',
      payoutProvider: PaymentMethod.PIX,
      pricingProvider: FlowPricingProvider.BINANCE,
      steps: [
        { type: 'PAYOUT' },
        { type: 'MOVE_TO_EXCHANGE', venue: 'BINANCE' },
        { fromAsset: SupportedCurrency.USDT, toAsset: SupportedCurrency.USDC, type: 'CONVERT', venue: 'BINANCE' },
        { asset: SupportedCurrency.USDC, fromVenue: 'BINANCE', toVenue: 'TRANSFERO', type: 'TRANSFER_VENUE' },
        { fromAsset: SupportedCurrency.USDC, toAsset: SupportedCurrency.BRL, type: 'CONVERT', venue: 'TRANSFERO' },
      ],
      targetCurrency: TargetCurrency.BRL,
    })

    const binanceConvert = steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'binance')
    const transfer = steps.find(s => s.stepType === FlowStepType.TREASURY_TRANSFER)
    const transferoConvert = steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'transfero')

    // First (Binance) convert converts the deposited amount — no upstream wiring.
    expect(binanceConvert?.config).not.toHaveProperty('amountSource')

    // Transfer withdraws exactly the Binance convert's realized output.
    expect(transfer?.config.amountSource).toEqual({ field: 'amount', kind: 'step', stepOrder: binanceConvert?.stepOrder })

    // Final Transfero convert converts exactly what the transfer delivered.
    expect(transferoConvert?.config.amountSource).toEqual({ field: 'amount', kind: 'step', stepOrder: transfer?.stepOrder })
  })

  // An async payout inserts AWAIT_PROVIDER_STATUS, shifting every later step's
  // absolute order. The wiring uses absolute orders, so it must follow the shift.
  it('wires amountSource to shifted absolute orders when the payout is async', () => {
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
    const transfer = steps.find(s => s.stepType === FlowStepType.TREASURY_TRANSFER)
    const transferoConvert = steps.find(s => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'transfero')

    expect(transfer?.config.amountSource).toEqual({ field: 'amount', kind: 'step', stepOrder: binanceConvert?.stepOrder })
    expect(transferoConvert?.config.amountSource).toEqual({ field: 'amount', kind: 'step', stepOrder: transfer?.stepOrder })
    // Sanity: the shift really happened (orders are not the sync-case values).
    expect(binanceConvert?.stepOrder).toBe(5)
    expect(transfer?.stepOrder).toBe(6)
  })
})
