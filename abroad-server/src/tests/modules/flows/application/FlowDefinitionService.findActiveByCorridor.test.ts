import { BlockchainNetwork, CryptoCurrency, FlowDirection, TargetCurrency } from '@prisma/client'

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
  version: 1,
})

describe('FlowDefinitionService.create persists direction', () => {
  const buildService = () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      blockchain: data.blockchain,
      createdAt: new Date(),
      cryptoCurrency: data.cryptoCurrency,
      direction: data.direction,
      enabled: true,
      exchangeFeePct: 0,
      fixedFee: 0,
      id: 'flow-1',
      maxAmount: null,
      minAmount: null,
      name: data.name,
      payoutProvider: data.payoutProvider,
      pricingProvider: data.pricingProvider,
      targetCurrency: data.targetCurrency,
      updatedAt: new Date(),
      userSteps: [{ type: 'PAYOUT' }],
      version: 1,
    }))
    const provider = {
      getClient: jest.fn(async () => ({ flowDefinition: { create } })),
    } as unknown as IDatabaseClientProvider
    const paymentServiceFactory = {
      getPaymentService: () => ({ isAsync: true }),
      getPaymentServiceForCapability: () => ({ isAsync: true }),
    }
    const service = new FlowDefinitionService(
      provider,
      new FlowDefinitionBuilder(paymentServiceFactory as never),
    )
    return { create, service }
  }

  // Omitting direction made every row fall back to the CRYPTO_TO_FIAT default,
  // so an onramp definition collided with the payout corridor for the same
  // asset pair and could never be created.
  it('writes FIAT_TO_CRYPTO when the payload asks for it', async () => {
    const { create, service } = buildService()

    await service.create({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      direction: FlowDirection.FIAT_TO_CRYPTO,
      name: 'USDC · STELLAR <- BRL',
      payoutProvider: 'PIX',
      pricingProvider: 'TRANSFERO',
      steps: [{ type: 'PAYOUT' }],
      targetCurrency: TargetCurrency.BRL,
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: FlowDirection.FIAT_TO_CRYPTO }),
    }))
  })

  it('defaults to CRYPTO_TO_FIAT when the payload omits direction', async () => {
    const { create, service } = buildService()

    await service.create({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      name: 'USDC · STELLAR -> BRL',
      payoutProvider: 'PIX',
      pricingProvider: 'TRANSFERO',
      steps: [{ type: 'PAYOUT' }],
      targetCurrency: TargetCurrency.BRL,
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: FlowDirection.CRYPTO_TO_FIAT }),
    }))
  })
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

    // A lookup without a stated direction resolves to the payout corridor
    // rather than matching an onramp definition for the same asset pair.
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        direction: FlowDirection.CRYPTO_TO_FIAT,
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
