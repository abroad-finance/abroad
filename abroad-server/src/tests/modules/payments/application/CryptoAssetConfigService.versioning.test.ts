import type { PrismaClient } from '@prisma/client'

import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { CryptoAssetConfigConflictError, CryptoAssetConfigService } from '../../../../modules/payments/application/CryptoAssetConfigService'

const buildService = (currentVersion: null | number, updateCount = 1) => {
  const base = {
    blockchain: BlockchainNetwork.STELLAR,
    cryptoCurrency: CryptoCurrency.USDC,
    decimals: 6,
    enabled: true,
    mintAddress: '0xasset',
    updatedAt: new Date('2026-08-02T15:00:00.000Z'),
  }
  const current = currentVersion === null
    ? null
    : {
        ...base,
        id: 'asset-config-1',
        version: currentVersion,
      }
  const created = {
    ...base,
    id: 'asset-config-created',
    version: 2,
  }
  const findUnique = jest.fn().mockResolvedValue(current)
  const create = jest.fn().mockResolvedValue(created)
  const updateMany = jest.fn().mockResolvedValue({ count: updateCount })
  const findMany = jest.fn().mockResolvedValue([{
    ...base,
    id: current?.id ?? created.id,
    version: (currentVersion ?? 1) + 1,
  }])
  const prismaClient = {
    cryptoAssetConfig: {
      create,
      findMany,
      findUnique,
      updateMany,
    },
  } as unknown as PrismaClient
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn().mockResolvedValue(prismaClient),
  }

  return {
    create,
    service: new CryptoAssetConfigService(provider),
    updateMany,
  }
}

const input = {
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  decimals: 6,
  enabled: true,
  mintAddress: '0xasset',
}

describe('CryptoAssetConfigService optimistic versioning', () => {
  it('increments an existing resource only when the expected version matches', async () => {
    const { service, updateMany } = buildService(4)

    await service.upsert(input, 4)

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: { increment: 1 } }),
      where: { id: 'asset-config-1', version: 4 },
    }))
  })

  it('creates a first persisted record as version two after editing the missing baseline', async () => {
    const { create, service } = buildService(null)

    await service.upsert(input, 1)

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2 }),
    })
  })

  it('rejects stale reads and update races', async () => {
    await expect(buildService(4).service.upsert(input, 3)).rejects.toBeInstanceOf(
      CryptoAssetConfigConflictError,
    )
    await expect(buildService(4, 0).service.upsert(input, 4)).rejects.toBeInstanceOf(
      CryptoAssetConfigConflictError,
    )
  })
})
