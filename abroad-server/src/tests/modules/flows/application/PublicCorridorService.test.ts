import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  FlowDirection,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { PublicCorridorService } from '../../../../modules/flows/application/PublicCorridorService'

const definition = (overrides: Record<string, unknown> = {}) => ({
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  enabled: true,
  maxAmount: 20_000,
  minAmount: 1,
  payoutProvider: PaymentMethod.PIX,
  targetCurrency: TargetCurrency.BRL,
  ...overrides,
})

type Where = { direction?: FlowDirection, status?: FlowCorridorStatus }

/**
 * Stands in for the database, answering each query with only the rows whose
 * direction the caller asked for — the behaviour under test is the where-clause
 * the service builds, so the fake must honour it rather than ignore it.
 */
const buildService = (options?: {
  definitions?: Array<Record<string, unknown> & { direction?: FlowDirection }>
  unsupported?: Array<Record<string, unknown> & { direction: FlowDirection }>
}) => {
  const definitions = options?.definitions ?? []
  const unsupported = options?.unsupported ?? []

  const findManyDefinitions = jest.fn(async ({ where }: { where: Where }) =>
    definitions.filter(row => row.direction === where.direction))
  const findManyCorridors = jest.fn(async ({ where }: { where: Where }) =>
    unsupported.filter(row => row.direction === where.direction))

  const client = {
    cryptoAssetConfig: {
      findMany: jest.fn(async () => [
        { blockchain: BlockchainNetwork.STELLAR, cryptoCurrency: CryptoCurrency.USDC },
      ]),
    },
    flowCorridor: { findMany: findManyCorridors },
    flowDefinition: { findMany: findManyDefinitions },
  }

  const dbProvider = {
    getClient: jest.fn(async () => client),
  } as unknown as IDatabaseClientProvider

  return {
    findManyDefinitions,
    service: new PublicCorridorService(dbProvider),
  }
}

describe('PublicCorridorService.list', () => {
  // The two directions of one pair collide on every field this DTO exposes, so
  // listing them together produced two indistinguishable entries and let an
  // onramp's limits be applied to a payout.
  it('does not leak the onramp corridor into the payout list', async () => {
    const { service } = buildService({
      definitions: [
        definition({ direction: FlowDirection.CRYPTO_TO_FIAT, maxAmount: 20_000, minAmount: 1 }),
        definition({ direction: FlowDirection.FIAT_TO_CRYPTO, maxAmount: 500, minAmount: 10 }),
      ],
    })

    const { corridors } = await service.list()

    expect(corridors).toHaveLength(1)
    expect(corridors[0]).toEqual(expect.objectContaining({ maxAmount: 20_000, minAmount: 1 }))
  })

  it('defaults to payouts so callers written before the onramp are unaffected', async () => {
    const { findManyDefinitions, service } = buildService()

    await service.list()

    expect(findManyDefinitions).toHaveBeenCalledWith(expect.objectContaining({
      where: { direction: FlowDirection.CRYPTO_TO_FIAT, enabled: true },
    }))
  })

  it('returns the onramp corridor with its own limits when asked for it', async () => {
    const { service } = buildService({
      definitions: [
        definition({ direction: FlowDirection.CRYPTO_TO_FIAT, maxAmount: 20_000, minAmount: 1 }),
        definition({ direction: FlowDirection.FIAT_TO_CRYPTO, maxAmount: 500, minAmount: 10 }),
      ],
    })

    const { corridors } = await service.list(FlowDirection.FIAT_TO_CRYPTO)

    expect(corridors).toHaveLength(1)
    expect(corridors[0]).toEqual(expect.objectContaining({ maxAmount: 500, minAmount: 10 }))
  })

  // Suspending payouts for a pair must not silently stop customers buying it,
  // and vice versa: the two are operated independently.
  it('suppresses an unsupported corridor only in its own direction', async () => {
    const { service } = buildService({
      definitions: [
        definition({ direction: FlowDirection.CRYPTO_TO_FIAT }),
        definition({ direction: FlowDirection.FIAT_TO_CRYPTO }),
      ],
      unsupported: [{
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        direction: FlowDirection.CRYPTO_TO_FIAT,
        targetCurrency: TargetCurrency.BRL,
      }],
    })

    await expect(service.list()).resolves.toEqual({ corridors: [] })
    const onramp = await service.list(FlowDirection.FIAT_TO_CRYPTO)
    expect(onramp.corridors).toHaveLength(1)
  })
})
