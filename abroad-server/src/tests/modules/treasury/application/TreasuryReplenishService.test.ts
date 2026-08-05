import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  ReplenishLegStatus,
  TargetCurrency,
  TreasuryReplenishStatus,
} from '@prisma/client'

import type { TransferoCryptoPurchaseService } from '../../../../modules/treasury/infrastructure/exchangeProviders/transferoCryptoPurchaseService'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { TreasuryReplenishService } from '../../../../modules/treasury/application/TreasuryReplenishService'
import { createMockLogger } from '../../../setup/mockFactories'

const leg = (overrides: Record<string, unknown> = {}) => ({
  asset: CryptoCurrency.USDC,
  destNetwork: BlockchainNetwork.CELO,
  fiatAmount: 100,
  fiatCurrency: TargetCurrency.BRL,
  id: 'leg-1',
  ...overrides,
})

const buildHarness = (opts?: {
  batches?: Record<string, unknown>[]
  buy?: jest.Mock
  pending?: Record<string, unknown>[]
  treasuryAddress?: string
  withdraw?: jest.Mock
}) => {
  const createdBatches: Record<string, unknown>[] = []
  const claimedLegs: Record<string, unknown>[] = []
  const updatedBatches: Record<string, unknown>[] = []

  const tx = {
    treasuryReplenishBatch: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const batch = { id: `batch-${createdBatches.length + 1}`, ...data }
        createdBatches.push(batch)
        return batch
      }),
      update: jest.fn(async (args: Record<string, unknown>) => {
        updatedBatches.push(args)
        return { id: 'batch-1' }
      }),
    },
    treasuryReplenishRequest: {
      updateMany: jest.fn(async (args: Record<string, unknown>) => {
        claimedLegs.push(args)
        return { count: 1 }
      }),
    },
  }

  const prisma = {
    $transaction: jest.fn(async (cb: (client: unknown) => Promise<unknown>) => cb(tx)),
    treasuryReplenishBatch: {
      findMany: jest.fn(async () => opts?.batches ?? []),
      update: tx.treasuryReplenishBatch.update,
    },
    treasuryReplenishRequest: {
      findMany: jest.fn(async () => opts?.pending ?? []),
      updateMany: tx.treasuryReplenishRequest.updateMany,
    },
  }

  const purchaseService = {
    buyWithBrl: opts?.buy
      ?? jest.fn(async () => ({ quantity: 18.2, success: true, tradeId: 'trade-1' })),
    withdrawToTreasury: opts?.withdraw
      ?? jest.fn(async () => ({ success: true, withdrawalId: 'wd-1' })),
  } as unknown as TransferoCryptoPurchaseService

  const secretManager = {
    getSecret: jest.fn(async () => opts?.treasuryAddress ?? '0xtreasury'),
    getSecrets: jest.fn(),
  } as unknown as ISecretManager

  const service = new TreasuryReplenishService(
    { getClient: jest.fn(async () => prisma) } as unknown as IDatabaseClientProvider,
    purchaseService,
    secretManager,
    createMockLogger(),
  )

  return { claimedLegs, createdBatches, prisma, purchaseService, service, updatedBatches }
}

describe('TreasuryReplenishService', () => {
  describe('batchPending', () => {
    it('pools every leg on one corridor into a single batch', async () => {
      const { createdBatches, service } = buildHarness({
        pending: [
          leg({ fiatAmount: 100, id: 'leg-1' }),
          leg({ fiatAmount: 250, id: 'leg-2' }),
        ],
      })

      const created = await service.batchPending()

      expect(created).toBe(1)
      expect(createdBatches).toHaveLength(1)
      expect(createdBatches[0]).toEqual(expect.objectContaining({
        asset: CryptoCurrency.USDC,
        destNetwork: BlockchainNetwork.CELO,
        fiatAmount: 350,
        status: TreasuryReplenishStatus.OPEN,
      }))
    })

    it('keeps separate corridors in separate batches', async () => {
      const { createdBatches, service } = buildHarness({
        pending: [
          leg({ destNetwork: BlockchainNetwork.CELO, id: 'leg-1' }),
          leg({ destNetwork: BlockchainNetwork.SOLANA, id: 'leg-2' }),
        ],
      })

      const created = await service.batchPending()

      expect(created).toBe(2)
      expect(createdBatches.map(batch => batch.destNetwork)).toEqual([
        BlockchainNetwork.CELO,
        BlockchainNetwork.SOLANA,
      ])
    })

    // A concurrent tick must not enrol the same leg twice, so the claim is
    // conditioned on the leg still being unbatched and pending.
    it('claims only legs that are still pending and unbatched', async () => {
      const { claimedLegs, service } = buildHarness({ pending: [leg()] })

      await service.batchPending()

      expect(claimedLegs[0]).toEqual(expect.objectContaining({
        data: { batchId: 'batch-1', status: ReplenishLegStatus.BATCHED },
        where: expect.objectContaining({
          batchId: null,
          status: ReplenishLegStatus.PENDING,
        }),
      }))
    })

    it('does nothing when there is no pending float to replace', async () => {
      const { createdBatches, service } = buildHarness({ pending: [] })

      expect(await service.batchPending()).toBe(0)
      expect(createdBatches).toHaveLength(0)
    })
  })

  describe('settleOpenBatches', () => {
    const openBatch = {
      asset: CryptoCurrency.USDC,
      destNetwork: BlockchainNetwork.CELO,
      fiatAmount: 350,
      id: 'batch-1',
      status: TreasuryReplenishStatus.OPEN,
      tradeId: null,
    }

    it('buys once per batch and records the trade before advancing', async () => {
      const { purchaseService, service, updatedBatches } = buildHarness({ batches: [openBatch] })

      const settled = await service.settleOpenBatches()

      expect(settled).toBe(1)
      expect(purchaseService.buyWithBrl).toHaveBeenCalledWith({
        asset: CryptoCurrency.USDC,
        brlAmount: 350,
        operationId: 'replenish:batch-1',
      })
      expect(updatedBatches[0]).toEqual(expect.objectContaining({
        data: expect.objectContaining({
          boughtAmount: 18.2,
          status: TreasuryReplenishStatus.BOUGHT,
          tradeId: 'trade-1',
        }),
      }))
    })

    // A retriable failure leaves the batch OPEN so the next tick reconciles it;
    // it must not be marked failed and re-pooled, which would buy twice.
    it('leaves a batch open when the buy is only retriably unavailable', async () => {
      const buy = jest.fn(async () => ({
        code: 'retriable' as const,
        reason: 'rate_limited',
        success: false as const,
      }))
      const { service, updatedBatches } = buildHarness({ batches: [openBatch], buy })

      expect(await service.settleOpenBatches()).toBe(0)
      expect(updatedBatches).toHaveLength(0)
    })

    it('fails the batch and releases its legs on a permanent rejection', async () => {
      const buy = jest.fn(async () => ({
        code: 'permanent' as const,
        reason: 'OTC_DEFERRED_REQUIRES_PTS',
        success: false as const,
      }))
      const { claimedLegs, service, updatedBatches } = buildHarness({ batches: [openBatch], buy })

      expect(await service.settleOpenBatches()).toBe(0)
      expect(updatedBatches[0]).toEqual(expect.objectContaining({
        data: expect.objectContaining({ status: TreasuryReplenishStatus.FAILED }),
      }))
      // The obligation survives the failure: legs return to the pending pool.
      expect(claimedLegs[0]).toEqual(expect.objectContaining({
        data: { batchId: null, status: ReplenishLegStatus.PENDING },
      }))
    })
  })

  describe('withdrawBoughtBatches', () => {
    const boughtBatch = {
      asset: CryptoCurrency.USDC,
      boughtAmount: 18.2,
      destNetwork: BlockchainNetwork.CELO,
      fiatAmount: 350,
      id: 'batch-1',
      status: TreasuryReplenishStatus.BOUGHT,
      withdrawalId: null,
    }

    it('withdraws to the configured treasury address and settles the legs', async () => {
      const { claimedLegs, purchaseService, service, updatedBatches } = buildHarness({
        batches: [boughtBatch],
      })

      expect(await service.withdrawBoughtBatches()).toBe(1)
      expect(purchaseService.withdrawToTreasury).toHaveBeenCalledWith({
        address: '0xtreasury',
        amount: 18.2,
        asset: CryptoCurrency.USDC,
        network: 'POLYGON',
        operationId: 'replenish:batch-1',
      })
      expect(updatedBatches[0]).toEqual(expect.objectContaining({
        data: expect.objectContaining({
          status: TreasuryReplenishStatus.WITHDRAWN,
          withdrawalId: 'wd-1',
        }),
      }))
      expect(claimedLegs[0]).toEqual(expect.objectContaining({
        data: { status: ReplenishLegStatus.SETTLED },
      }))
    })

    // The crypto is genuinely held at the provider; a missing address is a
    // configuration gap, not a reason to mark the batch failed.
    it('leaves batches bought when no treasury address is configured', async () => {
      const { service, updatedBatches } = buildHarness({
        batches: [boughtBatch],
        treasuryAddress: '   ',
      })

      expect(await service.withdrawBoughtBatches()).toBe(0)
      expect(updatedBatches).toHaveLength(0)
    })

    it('does not withdraw a batch whose bought quantity is unknown', async () => {
      const { purchaseService, service } = buildHarness({
        batches: [{ ...boughtBatch, boughtAmount: null }],
      })

      expect(await service.withdrawBoughtBatches()).toBe(0)
      expect(purchaseService.withdrawToTreasury).not.toHaveBeenCalled()
    })

    it('does not settle the legs when the withdrawal is rejected', async () => {
      const withdraw = jest.fn(async () => ({
        code: 'retriable' as const,
        reason: 'desk_unavailable',
        success: false as const,
      }))
      const { claimedLegs, service } = buildHarness({ batches: [boughtBatch], withdraw })

      expect(await service.withdrawBoughtBatches()).toBe(0)
      expect(claimedLegs).toHaveLength(0)
    })
  })
})
