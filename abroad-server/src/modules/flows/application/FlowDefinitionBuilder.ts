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

export class FlowDefinitionBuilderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowDefinitionBuilderError'
  }
}

type FlowSystemStep = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  signalMatch?: Record<string, unknown>
  stepOrder: number
  stepType: FlowStepType
}

type FlowLocation = FlowVenue | 'HOT_WALLET'

type BuildState = {
  asset: SupportedCurrency
  location: FlowLocation
}

@injectable()
export class FlowDefinitionBuilder {
  constructor(
    @inject(TYPES.IPaymentServiceFactory) private readonly paymentServiceFactory: IPaymentServiceFactory,
  ) {}

  public build(input: FlowDefinitionInput): FlowSystemStep[] {
    this.ensurePayoutFirst(input.steps)

    const payoutService = this.paymentServiceFactory.getPaymentService(input.payoutProvider)
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

    return systemSteps.map((step, index) => ({
      ...step,
      stepOrder: index + 1,
    }))
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

  private buildPayoutStep(paymentMethod: PaymentMethod): FlowSystemStep {
    return {
      completionPolicy: FlowStepCompletionPolicy.SYNC,
      config: { paymentMethod },
      stepOrder: 1,
      stepType: FlowStepType.PAYOUT_SEND,
    }
  }

  private buildAwaitProviderStatus(): FlowSystemStep {
    return {
      completionPolicy: FlowStepCompletionPolicy.AWAIT_EVENT,
      config: {},
      stepOrder: 1,
      stepType: FlowStepType.AWAIT_PROVIDER_STATUS,
    }
  }

  private expandStep(
    step: FlowBusinessStep,
    state: BuildState,
    targetCurrency: TargetCurrency,
  ): { state: BuildState, systemSteps: FlowSystemStep[] } {
    switch (step.type) {
      case 'MOVE_TO_EXCHANGE':
        return this.expandMoveToExchange(step, state)
      case 'CONVERT':
        return this.expandConvert(step, state, targetCurrency)
      case 'TRANSFER_VENUE':
        return this.expandTransferVenue(step, state, targetCurrency)
      case 'PAYOUT':
      default:
        throw new FlowDefinitionBuilderError('Unexpected payout step outside first position')
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

  private buildBinanceConvert(
    step: Extract<FlowBusinessStep, { type: 'CONVERT' }>,
  ): { side: 'BUY' | 'SELL', symbol: string } {
    const symbol = `${step.fromAsset}${step.toAsset}`
    return {
      side: 'SELL',
      symbol,
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

  private isTargetCurrency(value: SupportedCurrency): value is TargetCurrency {
    return Object.values(TargetCurrency).includes(value as TargetCurrency)
  }

  private mapVenueToProvider(venue: FlowVenue): 'binance' | 'transfero' {
    return venue === 'BINANCE' ? 'binance' : 'transfero'
  }
}
