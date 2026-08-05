import { FlowDirection } from '@prisma/client'

import { CorridorIdentifier } from '../contracts/ICorridorPricingProvider'

export class CorridorNotConfiguredError extends Error {
  constructor(corridor: CorridorIdentifier) {
    const direction = corridor.direction ?? FlowDirection.CRYPTO_TO_FIAT
    const [from, to] = direction === FlowDirection.FIAT_TO_CRYPTO
      ? [corridor.targetCurrency, `${corridor.cryptoCurrency}/${corridor.blockchain}`]
      : [`${corridor.cryptoCurrency}/${corridor.blockchain}`, corridor.targetCurrency]
    super(`No active flow definition for corridor ${from} → ${to}`)
    this.name = 'CorridorNotConfiguredError'
  }
}
