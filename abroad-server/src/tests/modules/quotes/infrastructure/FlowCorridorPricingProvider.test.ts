import { BlockchainNetwork, CryptoCurrency, FlowDirection, TargetCurrency } from '@prisma/client'

import type { FlowDefinitionService } from '../../../../modules/flows/application/FlowDefinitionService'

import { CorridorNotConfiguredError } from '../../../../modules/quotes/application/errors/CorridorNotConfiguredError'
import { FlowCorridorPricingProvider } from '../../../../modules/quotes/infrastructure/FlowCorridorPricingProvider'

const corridor = {
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  targetCurrency: TargetCurrency.COP,
}

describe('FlowCorridorPricingProvider', () => {
  const findActiveByCorridor = jest.fn()
  const flowDefinitionService = { findActiveByCorridor } as unknown as FlowDefinitionService
  const provider = new FlowCorridorPricingProvider(flowDefinitionService)

  beforeEach(() => {
    findActiveByCorridor.mockReset()
  })

  it('maps an enabled definition to corridor pricing', async () => {
    findActiveByCorridor.mockResolvedValue({
      exchangeFeePct: 0.0085,
      fixedFee: 0,
      maxAmount: 5_000_000,
      minAmount: 5_000,
    })

    const pricing = await provider.getPricing(corridor)

    // A corridor with no stated direction resolves to the payout side rather
    // than matching whichever direction happens to be configured first.
    expect(findActiveByCorridor).toHaveBeenCalledWith({
      ...corridor,
      direction: FlowDirection.CRYPTO_TO_FIAT,
    })
    expect(pricing).toEqual({
      exchangeFeePct: 0.0085,
      fixedFee: 0,
      maxAmount: 5_000_000,
      minAmount: 5_000,
    })
  })

  it('throws CorridorNotConfiguredError when no enabled definition exists', async () => {
    findActiveByCorridor.mockResolvedValue(null)

    await expect(provider.getPricing(corridor)).rejects.toThrow(CorridorNotConfiguredError)
    await expect(provider.getPricing(corridor)).rejects.toThrow(
      'No active flow definition for corridor USDC/STELLAR → COP',
    )
  })
})
