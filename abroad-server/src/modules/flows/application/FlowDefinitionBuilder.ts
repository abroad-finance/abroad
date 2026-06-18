import {
  FlowStepCompletionPolicy,
  FlowStepType,
  PaymentMethod,
  SupportedCurrency,
  TargetCurrency,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { FlowBusinessStep, FlowDefinitionInput, FlowVenue } from './flowDefinitionSchemas'

type BuildState = {
  asset: SupportedCurrency
  location: FlowLocation
}

type FlowLocation = 'HOT_WALLET' | FlowVenue

type FlowSystemStep = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  signalMatch?: Record<string, unknown>
  stepOrder: number
  stepType: FlowStepType
}

export class FlowDefinitionBuilderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowDefinitionBuilderError'
  }
}

@injectable()
export class FlowDefinitionBuilder {
  constructor(
    @inject(TYPES.IPaymentServiceFactory) private readonly paymentServiceFactory: IPaymentServiceFactory,
  ) {}

  public build(input: FlowDefinitionInput): FlowSystemStep[] {
    this.ensurePayoutFirst(input.steps)

    const payoutService = this.paymentServiceFactory.getPaymentServiceForCapability?.({
      paymentMethod: input.payoutProvider,
      targetCurrency: input.targetCurrency,
    }) ?? this.paymentServiceFactory.getPaymentService(input.payoutProvider)
    const systemSteps: FlowSystemStep[] = []

    const startAsset = input.cryptoCurrency as SupportedCurrency
    let state: BuildState = {
      asset: startAsset,
      location: 'HOT_WALLET',
    }

    systemSteps.push(this.buildPayoutStep(input.payoutProvider))
    if (payoutService.isAsync) {
      systemSteps.push(this.buildAwaitProviderStatus())
    }

    const businessSteps = input.steps.slice(1)
    for (const step of businessSteps) {
      const result = this.expandStep(step, state, input.targetCurrency)
      systemSteps.push(...result.systemSteps)
      state = result.state
    }

    const ordered = systemSteps.map((step, index) => ({
      ...step,
      stepOrder: index + 1,
    }))
    this.wireAmountSources(ordered)
    return ordered
  }

  private buildAwaitProviderStatus(): FlowSystemStep {
    return {
      completionPolicy: FlowStepCompletionPolicy.AWAIT_EVENT,
      config: {},
      stepOrder: 1,
      stepType: FlowStepType.AWAIT_PROVIDER_STATUS,
    }
  }

  private buildBinanceConvert(
    step: Extract<FlowBusinessStep, { type: 'CONVERT' }>,
  ): { fromAsset: SupportedCurrency, toAsset: SupportedCurrency } {
    // Emit the conversion intent only. Binance lists each pair in a single
    // direction (e.g. USDCUSDT, never USDTUSDC), so the venue-specific trading
    // symbol and side are resolved at execution time against live exchangeInfo
    // by the ExchangeConvertStepExecutor — guessing `${from}${to}` + SELL here
    // produced invalid symbols (e.g. USDTUSDC) for half of all pairs.
    return {
      fromAsset: step.fromAsset,
      toAsset: step.toAsset,
    }
  }

  private buildEnqueueBridge(pendingBridge: { asset: SupportedCurrency, destNetwork: string }): FlowSystemStep {
    return {
      completionPolicy: FlowStepCompletionPolicy.SYNC,
      config: { asset: pendingBridge.asset, destNetwork: pendingBridge.destNetwork },
      stepOrder: 1,
      stepType: FlowStepType.ENQUEUE_BRIDGE,
    }
  }

  private buildPayoutStep(paymentMethod: PaymentMethod): FlowSystemStep {
    return {
      completionPolicy: FlowStepCompletionPolicy.SYNC,
      config: { paymentMethod },
      stepOrder: 1,
      stepType: FlowStepType.PAYOUT_SEND,
    }
  }

  private buildTransferoConvert(
    step: Extract<FlowBusinessStep, { type: 'CONVERT' }>,
    targetCurrency: TargetCurrency,
  ): { sourceCurrency: SupportedCurrency, targetCurrency: TargetCurrency } {
    if (!this.isTargetCurrency(step.toAsset)) {
      throw new FlowDefinitionBuilderError('Transfero conversions must end in a fiat currency')
    }

    if (step.toAsset !== targetCurrency) {
      throw new FlowDefinitionBuilderError('Transfero conversion must target the corridor fiat currency')
    }

    if (this.isTargetCurrency(step.fromAsset)) {
      throw new FlowDefinitionBuilderError('Transfero conversion source must be a crypto asset')
    }

    return {
      sourceCurrency: step.fromAsset,
      targetCurrency: step.toAsset,
    }
  }

  private ensurePayoutFirst(steps: FlowBusinessStep[]): void {
    if (steps.length === 0) {
      throw new FlowDefinitionBuilderError('At least one step is required')
    }
    const [first] = steps
    if (first.type !== 'PAYOUT') {
      throw new FlowDefinitionBuilderError('Flow must start with a payout step')
    }
    const extraPayout = steps.slice(1).find(step => step.type === 'PAYOUT')
    if (extraPayout) {
      throw new FlowDefinitionBuilderError('Payout step can only appear once and must be first')
    }
  }

  private expandConvert(
    step: Extract<FlowBusinessStep, { type: 'CONVERT' }>,
    state: BuildState,
    targetCurrency: TargetCurrency,
  ): { state: BuildState, systemSteps: FlowSystemStep[] } {
    if (state.location !== step.venue) {
      throw new FlowDefinitionBuilderError(`Conversion requires funds at ${step.venue}`)
    }

    if (state.asset !== step.fromAsset) {
      throw new FlowDefinitionBuilderError(`Conversion source asset must be ${state.asset}`)
    }

    if (step.fromAsset === step.toAsset) {
      throw new FlowDefinitionBuilderError('Conversion assets must be different')
    }

    const provider = this.mapVenueToProvider(step.venue)

    const config = step.venue === 'TRANSFERO'
      ? this.buildTransferoConvert(step, targetCurrency)
      : this.buildBinanceConvert(step)

    const systemSteps: FlowSystemStep[] = [
      {
        completionPolicy: FlowStepCompletionPolicy.SYNC,
        config: {
          provider,
          ...config,
        },
        stepOrder: 1,
        stepType: FlowStepType.EXCHANGE_CONVERT,
      },
    ]

    return { state: { ...state, asset: step.toAsset }, systemSteps }
  }

  private expandMoveToExchange(
    step: Extract<FlowBusinessStep, { type: 'MOVE_TO_EXCHANGE' }>,
    state: BuildState,
  ): { state: BuildState, systemSteps: FlowSystemStep[] } {
    if (state.location !== 'HOT_WALLET') {
      throw new FlowDefinitionBuilderError('Funds must be in hot wallet before moving to an exchange')
    }

    const provider = this.mapVenueToProvider(step.venue)
    return {
      state: { ...state, location: step.venue },
      systemSteps: [
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: { provider },
          stepOrder: 1,
          stepType: FlowStepType.EXCHANGE_SEND,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.AWAIT_EVENT,
          config: { provider },
          stepOrder: 1,
          stepType: FlowStepType.AWAIT_EXCHANGE_BALANCE,
        },
      ],
    }
  }

  private expandStep(
    step: FlowBusinessStep,
    state: BuildState,
    targetCurrency: TargetCurrency,
  ): { state: BuildState, systemSteps: FlowSystemStep[] } {
    switch (step.type) {
      case 'CONVERT':
        return this.expandConvert(step, state, targetCurrency)
      case 'MOVE_TO_EXCHANGE':
        return this.expandMoveToExchange(step, state)
      case 'TRANSFER_VENUE':
        return this.expandTransferVenue(step, state)
      case 'PAYOUT':
      default:
        throw new FlowDefinitionBuilderError('Unexpected payout step outside first position')
    }
  }

  private expandTransferVenue(
    step: Extract<FlowBusinessStep, { type: 'TRANSFER_VENUE' }>,
    state: BuildState,
  ): { state: BuildState, systemSteps: FlowSystemStep[] } {
    if (state.location !== step.fromVenue) {
      throw new FlowDefinitionBuilderError(`Transfer requires funds at ${step.fromVenue}`)
    }

    if (state.asset !== step.asset) {
      throw new FlowDefinitionBuilderError(`Transfer asset must be ${state.asset}`)
    }

    if (step.fromVenue === step.toVenue) {
      throw new FlowDefinitionBuilderError('Transfer venues must be different')
    }

    if (step.fromVenue !== 'BINANCE') {
      throw new FlowDefinitionBuilderError('Only Binance can be used as a transfer source today')
    }

    if (step.toVenue !== 'TRANSFERO') {
      throw new FlowDefinitionBuilderError('Only Binance->Transfero transfers are supported today')
    }

    // Defer the Binance->Transfero crossing to a batched sweep. Emit NO
    // per-flow withdrawal (which would hit Binance's 5-USDC per-withdrawal
    // floor and strand small txs). Record the owed Binance USDC as an
    // ENQUEUE_BRIDGE leg HERE — before the following Transfero convert settles
    // the flow against the float — so a convert failure can never lose the
    // accounting of USDC that is already on Binance. The funds are logically at
    // the destination (settled against the float by the next convert).
    // destNetwork is the Binance withdrawal network for Transfero's USDC
    // deposit (Solana); the sweep re-verifies it against the provider before
    // withdrawing, so funds can never go to the wrong chain.
    return {
      state: { ...state, location: step.toVenue },
      systemSteps: [this.buildEnqueueBridge({ asset: step.asset, destNetwork: 'SOL' })],
    }
  }

  private findPreceding(steps: FlowSystemStep[], index: number, predicate: (step: FlowSystemStep) => boolean): number | undefined {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (predicate(steps[cursor])) {
        return steps[cursor].stepOrder
      }
    }
    return undefined
  }

  private isTargetCurrency(value: SupportedCurrency): value is TargetCurrency {
    return Object.values(TargetCurrency).includes(value as TargetCurrency)
  }

  private mapVenueToProvider(venue: FlowVenue): 'binance' | 'transfero' {
    return venue === 'BINANCE' ? 'binance' : 'transfero'
  }

  /**
   * Propagate REALIZED amounts between hops. Each step must act on what the
   * previous step actually produced — never the original quoted sourceAmount,
   * which ignores spread + fees. The USDC that reaches Binance is the Binance
   * USDT->USDC convert's realized output (USDT corridors) or, with no Binance
   * convert, the deposit itself (default sourceAmount — pure-USDC corridors and
   * Solana/Stellar direct corridors):
   *  - the Transfero (float) convert converts exactly that USDC;
   *  - the ENQUEUE_BRIDGE leg records exactly that USDC for the sweep.
   * The legacy synchronous TREASURY_TRANSFER (if any corridor still uses it)
   * withdraws the preceding convert's realized output.
   */
  private wireAmountSources(steps: FlowSystemStep[]): void {
    const isBinanceConvert = (s: FlowSystemStep) => s.stepType === FlowStepType.EXCHANGE_CONVERT && s.config.provider === 'binance'

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]
      if (step.config.amountSource !== undefined) {
        continue
      }

      if (step.stepType === FlowStepType.ENQUEUE_BRIDGE) {
        const order = this.findPreceding(steps, index, isBinanceConvert)
        if (order !== undefined) {
          step.config = { ...step.config, amountSource: { field: 'amount', kind: 'step', stepOrder: order } }
        }
      }
      else if (step.stepType === FlowStepType.EXCHANGE_CONVERT && step.config.provider === 'transfero') {
        const order = this.findPreceding(steps, index, isBinanceConvert)
          ?? this.findPreceding(steps, index, s => s.stepType === FlowStepType.TREASURY_TRANSFER)
        if (order !== undefined) {
          step.config = { ...step.config, amountSource: { field: 'amount', kind: 'step', stepOrder: order } }
        }
      }
      else if (step.stepType === FlowStepType.TREASURY_TRANSFER) {
        const order = this.findPreceding(steps, index, s => s.stepType === FlowStepType.EXCHANGE_CONVERT)
        if (order !== undefined) {
          step.config = { ...step.config, amountSource: { field: 'amount', kind: 'step', stepOrder: order } }
        }
      }
    }
  }
}
