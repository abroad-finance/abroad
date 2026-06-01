import { inject, injectable } from 'inversify'

import { FlowDefinitionService } from '../../flows/application/FlowDefinitionService'
import { CorridorIdentifier, CorridorPricing, ICorridorPricingProvider } from '../application/contracts/ICorridorPricingProvider'
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
