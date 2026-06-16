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

    return {
      state: { ...state, asset: step.toAsset },
      systemSteps: [
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: {
            provider,
            ...config,
          },
          stepOrder: 1,
          stepType: FlowStepType.EXCHANGE_CONVERT,
        },
      ],
    }
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
        return this.expandTransferVenue(step, state, targetCurrency)
      case 'PAYOUT':
      default:
        throw new FlowDefinitionBuilderError('Unexpected payout step outside first position')
    }
  }

  private expandTransferVenue(
    step: Extract<FlowBusinessStep, { type: 'TRANSFER_VENUE' }>,
    state: BuildState,
    targetCurrency: TargetCurrency,
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

    const destinationProvider = this.mapVenueToProvider(step.toVenue)

    return {
      state: { ...state, location: step.toVenue },
      systemSteps: [
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: {
            asset: step.asset,
            destinationProvider,
            destinationTargetCurrency: targetCurrency,
            sourceProvider: 'binance',
          },
          stepOrder: 1,
          stepType: FlowStepType.TREASURY_TRANSFER,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.AWAIT_EVENT,
          config: { provider: destinationProvider },
          stepOrder: 1,
          stepType: FlowStepType.AWAIT_EXCHANGE_BALANCE,
        },
      ],
    }
  }

  private findPrecedingStepOrder(steps: FlowSystemStep[], index: number, stepType: FlowStepType): number | undefined {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (steps[cursor].stepType === stepType) {
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
   * Propagate REALIZED amounts between money-moving hops. Each hop loses value
   * to spread/fees, so a step must act on what the previous step actually
   * produced — never the original quoted sourceAmount:
   *  - TREASURY_TRANSFER withdraws the preceding EXCHANGE_CONVERT's realized output.
   *  - an EXCHANGE_CONVERT that follows a TREASURY_TRANSFER converts what that
   *    transfer delivered.
   * The first convert (no preceding transfer) keeps the default sourceAmount: it
   * converts the deposit that EXCHANGE_SEND moved onto the venue.
   */
  private wireAmountSources(steps: FlowSystemStep[]): void {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]
      if (step.config.amountSource !== undefined) {
        continue
      }

      if (step.stepType === FlowStepType.TREASURY_TRANSFER) {
        const convertOrder = this.findPrecedingStepOrder(steps, index, FlowStepType.EXCHANGE_CONVERT)
        if (convertOrder !== undefined) {
          step.config = { ...step.config, amountSource: { field: 'amount', kind: 'step', stepOrder: convertOrder } }
        }
      }
      else if (step.stepType === FlowStepType.EXCHANGE_CONVERT) {
        const transferOrder = this.findPrecedingStepOrder(steps, index, FlowStepType.TREASURY_TRANSFER)
        if (transferOrder !== undefined) {
          step.config = { ...step.config, amountSource: { field: 'amount', kind: 'step', stepOrder: transferOrder } }
        }
      }
    }
  }
}
