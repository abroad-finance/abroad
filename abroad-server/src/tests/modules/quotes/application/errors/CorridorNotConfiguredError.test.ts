import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import { CorridorNotConfiguredError } from '../../../../../modules/quotes/application/errors/CorridorNotConfiguredError'

describe('CorridorNotConfiguredError', () => {
  it('builds a descriptive message and name from the corridor', () => {
    const error = new CorridorNotConfiguredError({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.COP,
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('CorridorNotConfiguredError')
    expect(error.message).toBe('No active flow definition for corridor USDC/STELLAR → COP')
  })
})
