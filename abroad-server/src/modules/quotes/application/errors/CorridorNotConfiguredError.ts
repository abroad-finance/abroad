import { CorridorIdentifier } from '../contracts/ICorridorPricingProvider'

export class CorridorNotConfiguredError extends Error {
  constructor(corridor: CorridorIdentifier) {
    super(
      `No active flow definition for corridor ${corridor.cryptoCurrency}/${corridor.blockchain} → ${corridor.targetCurrency}`,
    )
    this.name = 'CorridorNotConfiguredError'
  }
}
