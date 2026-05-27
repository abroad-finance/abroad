import 'reflect-metadata'
import { PaymentMethod } from '@prisma/client'

import { LiquidityCacheService } from '../../../../modules/payments/application/LiquidityCacheService'
import { createMockLogger } from '../../../setup/mockFactories'

describe('LiquidityCacheService', () => {
  const now = Date.now()
  const fresh = new Date(now - 60_000) // 1 min old, within default 5 min TTL
  const stale = new Date(now - 10 * 60_000) // 10 min old, beyond TTL but within max-stale
  const ancient = new Date(now - 2 * 60 * 60_000) // 2 h old, beyond default 1 h max-stale

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

  // Wait for any background refresh microtasks/macrotasks the service started.
  const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve))

  it('returns cached liquidity when fresh and does not call the provider', async () => {
    const liquidity = 125
    const fetchLiquidity = jest.fn(async () => 0)
    const { prisma, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn(async () => ({ id: PaymentMethod.PIX, liquidity, updatedAt: fresh })),
      },
    })

    const result = await service.getLiquidity({ fetchLiquidity, method: PaymentMethod.PIX, now })

    expect(result).toEqual({ fromCache: true, liquidity, success: true })
    expect(fetchLiquidity).not.toHaveBeenCalled()
    expect(prisma.paymentProvider.update).not.toHaveBeenCalled()
  })

  it('returns stale cached liquidity immediately and triggers a single background refresh', async () => {
    const fetchLiquidity = jest.fn(async () => 200)
    const { prisma, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn(async () => ({ id: PaymentMethod.PIX, liquidity: 10, updatedAt: stale })),
      },
    })

    const result = await service.getLiquidity({ fetchLiquidity, method: PaymentMethod.PIX, now })

    expect(result).toEqual({ fromCache: true, liquidity: 10, stale: true, success: true })

    await flushPromises()

    expect(fetchLiquidity).toHaveBeenCalledTimes(1)
    expect(prisma.paymentProvider.update).toHaveBeenCalledWith({
      data: { liquidity: 200 },
      where: { id: PaymentMethod.PIX },
    })
  })

  it('does not surface background refresh failures to the caller', async () => {
    const fetchLiquidity = jest.fn(async () => {
      throw new Error('Movii API unavailable')
    })
    const { logger, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn(async () => ({ id: PaymentMethod.PIX, liquidity: 15, updatedAt: stale })),
      },
    })

    const result = await service.getLiquidity({ fetchLiquidity, method: PaymentMethod.PIX, now })

    expect(result).toEqual({ fromCache: true, liquidity: 15, stale: true, success: true })

    await flushPromises()

    expect(logger.warn).toHaveBeenCalled()
  })

  it('synchronously fetches when no cached value exists at all', async () => {
    const fetchLiquidity = jest.fn(async () => 500)
    const { prisma, service } = buildService({
      paymentProvider: {
        // First call: no record. Second call (after refresh write): present.
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: PaymentMethod.PIX, liquidity: 500, updatedAt: new Date(now) }),
      },
    })

    const result = await service.getLiquidity({ fetchLiquidity, method: PaymentMethod.PIX, now })

    expect(result).toEqual({ fromCache: false, liquidity: 500, success: true })
    expect(fetchLiquidity).toHaveBeenCalledTimes(1)
    expect(prisma.paymentProvider.update).toHaveBeenCalledWith({
      data: { liquidity: 500 },
      where: { id: PaymentMethod.PIX },
    })
  })

  it('synchronously fetches when cached value is older than the max-stale window', async () => {
    const fetchLiquidity = jest.fn(async () => 400)
    const { prisma, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: PaymentMethod.PIX, liquidity: 5, updatedAt: ancient })
          .mockResolvedValueOnce({ id: PaymentMethod.PIX, liquidity: 400, updatedAt: new Date(now) }),
      },
    })

    const result = await service.getLiquidity({ fetchLiquidity, method: PaymentMethod.PIX, now })

    expect(result).toEqual({ fromCache: false, liquidity: 400, success: true })
    expect(prisma.paymentProvider.update).toHaveBeenCalled()
  })

  it('returns success:false with cached value on sync-path fetch failure', async () => {
    const fetchLiquidity = jest.fn(async () => {
      throw new Error('boom')
    })
    const { logger, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn(async () => ({ id: PaymentMethod.PIX, liquidity: 7, updatedAt: ancient })),
      },
    })

    const result = await service.getLiquidity({ fetchLiquidity, method: PaymentMethod.PIX, now })

    expect(result).toEqual({ fromCache: true, liquidity: 7, message: 'boom', success: false })
    expect(logger.error).toHaveBeenCalled()
  })

  it('deduplicates concurrent stale refreshes (single-flight)', async () => {
    let resolveFetch: ((value: number) => void) | undefined
    const fetchLiquidity = jest.fn(() => new Promise<number>((resolve) => {
      resolveFetch = resolve
    }))
    const { prisma, service } = buildService({
      paymentProvider: {
        findUnique: jest.fn(async () => ({ id: PaymentMethod.PIX, liquidity: 10, updatedAt: stale })),
      },
    })

    const [r1, r2] = await Promise.all([
      service.getLiquidity({ fetchLiquidity, method: PaymentMethod.PIX, now }),
      service.getLiquidity({ fetchLiquidity, method: PaymentMethod.PIX, now }),
    ])

    expect(r1.stale).toBe(true)
    expect(r2.stale).toBe(true)
    expect(fetchLiquidity).toHaveBeenCalledTimes(1)

    resolveFetch?.(99)
    await flushPromises()

    expect(prisma.paymentProvider.update).toHaveBeenCalledTimes(1)
  })
})
