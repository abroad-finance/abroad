import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import { findCorridorsMissingPricing } from '../../../../modules/flows/application/corridorPricingAudit'

const corridor = (targetCurrency: TargetCurrency) => ({
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  targetCurrency,
})

describe('findCorridorsMissingPricing', () => {
  it('returns labels for SUPPORTED corridors lacking an enabled definition', async () => {
    const prisma = {
      flowCorridor: {
        findMany: jest.fn(async () => [corridor(TargetCurrency.COP), corridor(TargetCurrency.BRL)]),
      },
      flowDefinition: {
        findFirst: jest.fn(async ({ where }: { where: { targetCurrency: TargetCurrency } }) =>
          where.targetCurrency === TargetCurrency.COP ? { id: 'def-cop' } : null),
      },
    }

    const missing = await findCorridorsMissingPricing(prisma)

    expect(prisma.flowCorridor.findMany).toHaveBeenCalledWith({ where: { status: 'SUPPORTED' } })
    expect(missing).toEqual(['USDC/STELLAR → BRL'])
  })

  it('returns an empty list when every SUPPORTED corridor has an enabled definition', async () => {
    const prisma = {
      flowCorridor: { findMany: jest.fn(async () => [corridor(TargetCurrency.COP)]) },
      flowDefinition: { findFirst: jest.fn(async () => ({ id: 'def-cop' })) },
    }

    const missing = await findCorridorsMissingPricing(prisma)

    expect(missing).toEqual([])
  })
})
