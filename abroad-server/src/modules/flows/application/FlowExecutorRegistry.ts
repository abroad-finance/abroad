import { FlowStepType } from '@prisma/client'
import { injectable, multiInject, optional } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { FlowStepExecutor } from './flowTypes'

@injectable()
export class FlowExecutorRegistry {
  private readonly executors: Map<FlowStepType, FlowStepExecutor>

  public constructor(
    @optional()
    @multiInject(TYPES.FlowStepExecutor)
    executors: FlowStepExecutor[] = [],
  ) {
    this.executors = new Map()
    for (const executor of executors) {
      this.executors.set(executor.stepType, executor)
    }
  }

  public get(stepType: FlowStepType): FlowStepExecutor {
    const executor = this.executors.get(stepType)
    if (!executor) {
      throw new Error(`No flow step executor registered for ${stepType}`)
    }
    return executor
  }
}
