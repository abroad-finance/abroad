import type { PrismaClient } from '@prisma/client'

import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowPricingProvider,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { FlowDefinitionBuilder } from '../../../../modules/flows/application/FlowDefinitionBuilder'
import { FlowDefinitionConflictError, FlowDefinitionService } from '../../../../modules/flows/application/FlowDefinitionService'

const payload = {
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  enabled: true,
  exchangeFeePct: 0.0085,
  fixedFee: 0,
  maxAmount: 5_000_000,
  minAmount: 5_000,
  name: 'USDC Stellar to BRL',
  payoutProvider: PaymentMethod.PIX,
  pricingProvider: FlowPricingProvider.TRANSFERO,
  steps: [{ type: 'PAYOUT' as const }],
  targetCurrency: TargetCurrency.BRL,
}

const buildService = (updateCount: number) => {
  const updateMany = jest.fn().mockResolvedValue({ count: updateCount })
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
  const update = jest.fn().mockResolvedValue({
    ...payload,
    createdAt: new Date('2026-08-02T14:00:00.000Z'),
    id: 'flow-1',
    updatedAt: new Date('2026-08-02T15:00:00.000Z'),
    userSteps: payload.steps,
    version: 5,
  })
  const transactionClient = {
    flowDefinition: { update, updateMany },
    flowStepDefinition: { deleteMany },
  }
  const prismaClient = {
    $transaction: jest.fn(async (operation: (client: typeof transactionClient) => Promise<unknown>) => (
      operation(transactionClient)
    )),
  } as unknown as PrismaClient
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn().mockResolvedValue(prismaClient),
  }
  const builder = {
    build: jest.fn().mockReturnValue([]),
  } as unknown as FlowDefinitionBuilder

  return {
    deleteMany,
    service: new FlowDefinitionService(provider, builder),
    update,
    updateMany,
  }
}

describe('FlowDefinitionService optimistic versioning', () => {
  it('claims the expected version before replacing a definition', async () => {
    const { deleteMany, service, update, updateMany } = buildService(1)

    const result = await service.update('flow-1', payload, 4)

    expect(updateMany).toHaveBeenCalledWith({
      data: { version: { increment: 1 } },
      where: { id: 'flow-1', version: 4 },
    })
    expect(deleteMany).toHaveBeenCalledWith({ where: { flowDefinitionId: 'flow-1' } })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'flow-1' } }))
    expect(result.version).toBe(5)
  })

  it('does not replace steps when another operator already changed the definition', async () => {
    const { deleteMany, service, update } = buildService(0)

    await expect(service.update('flow-1', payload, 4)).rejects.toBeInstanceOf(
      FlowDefinitionConflictError,
    )

    expect(deleteMany).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
