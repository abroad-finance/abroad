import { FlowStepType } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import {
  FlowSignalInput,
  FlowStepExecutionResult,
  FlowStepExecutor,
  FlowStepRuntimeContext,
  FlowStepSignalResult,
} from '../flowTypes'

const awaitExchangeBalanceConfigSchema = z.object({
  provider: z.enum(['binance', 'transfero']).default('binance'),
})

@injectable()
export class AwaitExchangeBalanceStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.AWAIT_EXCHANGE_BALANCE

  constructor(@inject(TYPES.ILogger) _baseLogger: ILogger) {}

  public async execute(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult> {
    void params.runtime
    void params.stepOrder
    const parsed = awaitExchangeBalanceConfigSchema.safeParse(params.config)
    if (!parsed.success) {
      return { error: parsed.error.message, outcome: 'failed' }
    }

    return {
      correlation: { provider: parsed.data.provider },
      outcome: 'waiting',
      output: { provider: parsed.data.provider },
    }
  }

  public async handleSignal(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    signal: FlowSignalInput
    stepOrder: number
  }): Promise<FlowStepSignalResult> {
    void params.runtime
    void params.stepOrder
    const parsed = awaitExchangeBalanceConfigSchema.safeParse(params.config)
    if (!parsed.success) {
      return { error: parsed.error.message, outcome: 'failed' }
    }

    const expectedProvider = parsed.data.provider
    const signalProvider = typeof params.signal.correlationKeys.provider === 'string'
      ? params.signal.correlationKeys.provider
      : undefined

    if (signalProvider && signalProvider !== expectedProvider) {
      return { correlation: { provider: expectedProvider }, outcome: 'waiting' }
    }

    return { outcome: 'succeeded' }
  }
}
