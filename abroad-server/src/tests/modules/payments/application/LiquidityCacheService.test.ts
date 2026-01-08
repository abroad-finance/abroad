import 'reflect-metadata'
import { PaymentMethod } from '@prisma/client'

import { LiquidityCacheService } from '../../../../modules/payments/application/LiquidityCacheService'
import { createMockLogger } from '../../../setup/mockFactories'

describe('LiquidityCacheService', () => {
  const now = Date.now()
  const recent = new Date(now - 60_000)
  const stale = new Date(now - 10 * 60_000)

  type PaymentProviderMock = {
    create: jest.Mock<Promise<undefined>, []>
    findUnique: jest.Mock<Promise<null | { id: PaymentMethod, liquidity: number, updatedAt: Date }>, []>
    update: jest.Mock<Promise<undefined>, [{ data: { liquidity: number }, where: { id: PaymentMethod } }]>
  }

  type PrismaClientMock = { paymentProvider: PaymentProviderMock }
  type PrismaOverrides = { paymentProvider?: Partial<PaymentProviderMock> }

  const buildPaymentProvider = (overrides?: Partial<PaymentProviderMock>): PaymentProviderMock => ({
    create: jest.fn<Promise<undefined>, []>(async () => undefined),
    findUnique: jest.fn<Promise<null | { id: PaymentMethod, liquidity: number, updatedAt: Date }>, []>(async () => null),
    update: jest.fn<Promise<undefined>, [{ data: { liquidity: number }, where: { id: PaymentMethod } }]>(
      async () => undefined,
    ),
    ...(overrides ?? {}),
  })

  const buildPrisma = (overrides: PrismaOverrides = {}): PrismaClientMock => ({
    paymentProvider: buildPaymentProvider(overrides.paymentProvider),
  })

  const buildService = (prismaOverrides?: PrismaOverrides) => {
    const prisma = buildPrisma(prismaOverrides)
    const provider = { getClient: jest.fn(async () => prisma) }
    const logger = createMockLogger()
    const service = new LiquidityCacheService(provider as never, logger)
    return { logger, prisma, provider, service }
  }

  it('returns cached liquidity when fresh', async () => {
    const liquidity = 125
    const { provider, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn(async () => ({ id: PaymentMethod.PIX, liquidity, updatedAt: recent })),
      },
    })

    const result = await service.getLiquidity({
      fetchLiquidity: jest.fn(async () => 0),
      method: PaymentMethod.PIX,
      now,
    })

    expect(provider.getClient).toHaveBeenCalled()
    expect(result).toEqual({ fromCache: true, liquidity, success: true })
  })

  it('refreshes stale liquidity and updates storage', async () => {
    const { prisma, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn(async () => ({ id: PaymentMethod.PIX, liquidity: 10, updatedAt: stale })),
      },
    })

    const result = await service.getLiquidity({
      fetchLiquidity: jest.fn(async () => 200),
      method: PaymentMethod.PIX,
      now,
    })

    expect(prisma.paymentProvider.update).toHaveBeenCalledWith({
      data: { liquidity: 200 },
      where: { id: PaymentMethod.PIX },
    })
    expect(result).toEqual({ fromCache: false, liquidity: 200, success: true })
  })

  it('falls back to cached liquidity and marks failure when refresh throws', async () => {
    const { logger, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn(async () => ({ id: PaymentMethod.PIX, liquidity: 15, updatedAt: stale })),
      },
    })

    const result = await service.getLiquidity({
      fetchLiquidity: jest.fn(async () => { throw new Error('network') }),
      method: PaymentMethod.PIX,
      now,
    })

    expect(logger.error).toHaveBeenCalled()
    expect(result).toEqual({ fromCache: true, liquidity: 15, message: 'network', success: false })
  })
})
