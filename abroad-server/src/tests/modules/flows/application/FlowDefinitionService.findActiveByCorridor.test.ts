import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { FlowDefinitionBuilder } from '../../../../modules/flows/application/FlowDefinitionBuilder'
import { FlowDefinitionService } from '../../../../modules/flows/application/FlowDefinitionService'

const corridor = {
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  targetCurrency: TargetCurrency.COP,
}

const buildRow = () => ({
  blockchain: BlockchainNetwork.STELLAR,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  cryptoCurrency: CryptoCurrency.USDC,
  enabled: true,
  exchangeFeePct: 0.0085,
  fixedFee: 0,
  id: 'def-1',
  maxAmount: 5_000_000,
  minAmount: 5_000,
  name: 'USDC Stellar → COP',
  payoutProvider: 'BREB',
  pricingProvider: 'BINANCE',
  targetCurrency: TargetCurrency.COP,
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  userSteps: [],
})

describe('FlowDefinitionService.findActiveByCorridor', () => {
  const findFirst = jest.fn()
  const prisma = { flowDefinition: { findFirst } }
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const service = new FlowDefinitionService(dbProvider, {} as unknown as FlowDefinitionBuilder)

  beforeEach(() => {
    findFirst.mockReset()
  })

  it('returns the mapped definition when an enabled row exists', async () => {
    findFirst.mockResolvedValue(buildRow())

    const result = await service.findActiveByCorridor(corridor)

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        enabled: true,
        targetCurrency: TargetCurrency.COP,
      },
    })
    expect(result).toMatchObject({
      exchangeFeePct: 0.0085,
      fixedFee: 0,
      maxAmount: 5_000_000,
      minAmount: 5_000,
    })
  })

  it('returns null when no enabled row matches', async () => {
    findFirst.mockResolvedValue(null)

    const result = await service.findActiveByCorridor(corridor)

    expect(result).toBeNull()
  })
})
