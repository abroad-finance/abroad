import type { PrismaClient } from '@prisma/client'

import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  FlowDirection,
  TargetCurrency,
} from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { FlowCorridorConflictError, FlowCorridorService } from '../../../../modules/flows/application/FlowCorridorService'

const payload = {
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  reason: 'Provider maintenance',
  status: FlowCorridorStatus.UNSUPPORTED,
  targetCurrency: TargetCurrency.BRL,
}

const buildService = (version: number, updateCount = 1) => {
  // `payload` carries no direction, so this also pins the rule that an update
  // input without one resolves to the platform default rather than missing the
  // stored corridor.
  const current = {
    ...payload,
    createdAt: new Date('2026-08-02T14:00:00.000Z'),
    direction: FlowDirection.CRYPTO_TO_FIAT,
    id: 'corridor-1',
    updatedAt: new Date('2026-08-02T15:00:00.000Z'),
    version,
  }
  const updateMany = jest.fn().mockResolvedValue({ count: updateCount })
  const prismaClient = {
    cryptoAssetConfig: {
      findMany: jest.fn().mockResolvedValue([{
        blockchain: payload.blockchain,
        cryptoCurrency: payload.cryptoCurrency,
      }]),
    },
    flowCorridor: {
      findMany: jest.fn().mockResolvedValue([{ ...current, version: version + 1 }]),
      findUnique: jest.fn().mockResolvedValue(current),
      updateMany,
    },
    flowDefinition: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn().mockResolvedValue(prismaClient),
  }
  return {
    service: new FlowCorridorService(provider),
    updateMany,
  }
}

describe('FlowCorridorService optimistic versioning', () => {
  it('preserves the corridor record and increments its version', async () => {
    const { service, updateMany } = buildService(3)

    const result = await service.updateStatus(payload, 3)

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: { increment: 1 } }),
      where: { id: 'corridor-1', version: 3 },
    }))
    expect(result).toEqual(expect.objectContaining({
      status: 'UNSUPPORTED',
      version: 4,
    }))
  })

  it('rejects a stale version and a concurrent update race', async () => {
    await expect(buildService(3).service.updateStatus(payload, 2)).rejects.toBeInstanceOf(
      FlowCorridorConflictError,
    )
    await expect(buildService(3, 0).service.updateStatus(payload, 3)).rejects.toBeInstanceOf(
      FlowCorridorConflictError,
    )
  })
})
