import 'reflect-metadata'
import { Country, PaymentMethod, TargetCurrency } from '@prisma/client'

import type { IPaymentService } from '../../../../modules/payments/application/contracts/IPaymentService'
import type { IPaymentServiceFactory } from '../../../../modules/payments/application/contracts/IPaymentServiceFactory'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { PaymentUseCase } from '../../../../modules/payments/application/paymentUseCase'
import { createMockLogger, MockLogger } from '../../../setup/mockFactories'

type PrismaLike = {
  paymentProvider: {
    update: jest.Mock
    upsert: jest.Mock
  }
}

const buildPaymentService = (
  overrides?: Partial<jest.Mocked<IPaymentService>>,
): jest.Mocked<IPaymentService> => ({
  currency: TargetCurrency.COP,
  fixedFee: 0,
  getLiquidity: jest.fn(async () => 75),
  isAsync: false,
  isEnabled: true,
  MAX_TOTAL_AMOUNT_PER_DAY: 0,
  MAX_USER_AMOUNT_PER_DAY: 0,
  MAX_USER_AMOUNT_PER_TRANSACTION: 0,
  MAX_USER_TRANSACTIONS_PER_DAY: 0,
  MIN_USER_AMOUNT_PER_TRANSACTION: 0,
  onboardUser: jest.fn(async ({ account }: { account: string }) => ({ message: `ok:${account}`, success: true })),
  percentageFee: 0,
  sendPayment: jest.fn(),
  verifyAccount: jest.fn(async ({ account, bankCode }: { account: string, bankCode: string }) => Boolean(account && bankCode)),
  ...(overrides ?? {}),
})

const buildUseCase = ({
  logger = createMockLogger(),
  paymentService = buildPaymentService(),
  paymentServiceFactory = {
    getPaymentService: jest.fn<IPaymentService, [PaymentMethod]>(() => paymentService),
  } as jest.Mocked<IPaymentServiceFactory>,
  prismaClient = {
    paymentProvider: {
      update: jest.fn(),
      upsert: jest.fn(),
    },
  } as PrismaLike,
} = {}) => {
  const dbProvider: jest.Mocked<IDatabaseClientProvider> = {
    getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
  }

  const useCase = new PaymentUseCase(paymentServiceFactory, dbProvider, logger as unknown as MockLogger)

  return { dbProvider, logger, paymentService, paymentServiceFactory, prismaClient, useCase }
}

describe('PaymentUseCase', () => {
  it('rejects when the payment service is disabled', async () => {
    const paymentService = buildPaymentService({ isEnabled: false })
    const { useCase } = buildUseCase({
      paymentService,
      paymentServiceFactory: { getPaymentService: jest.fn<IPaymentService, [PaymentMethod]>(() => paymentService) } as jest.Mocked<IPaymentServiceFactory>,
    })

    await expect(useCase.getLiquidity(PaymentMethod.BREB)).rejects.toThrow(/unavailable/i)
  })

  it('returns cached liquidity without invoking the payment provider', async () => {
    const prismaClient: PrismaLike = {
      paymentProvider: {
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({
          country: Country.CO,
          id: PaymentMethod.BREB,
          liquidity: 250,
          name: PaymentMethod.BREB,
        }),
      },
    }
    const { paymentService, useCase } = buildUseCase({ prismaClient })

    const response = await useCase.getLiquidity(PaymentMethod.BREB)

    expect(response).toEqual({
      liquidity: 250,
      message: 'Liquidity retrieved successfully',
      success: true,
    })
    expect(paymentService.getLiquidity).not.toHaveBeenCalled()
    expect(prismaClient.paymentProvider.update).not.toHaveBeenCalled()
  })

  it('fetches liquidity from the service and updates persistence when missing', async () => {
    const prismaClient: PrismaLike = {
      paymentProvider: {
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({
          country: Country.CO,
          id: PaymentMethod.BREB,
          liquidity: 0,
          name: PaymentMethod.BREB,
        }),
      },
    }
    const paymentService = buildPaymentService({ getLiquidity: jest.fn(async () => 510) })
    const { useCase } = buildUseCase({ paymentService, prismaClient })

    const response = await useCase.getLiquidity()

    expect(paymentService.getLiquidity).toHaveBeenCalled()
    expect(prismaClient.paymentProvider.update).toHaveBeenCalledWith({
      data: { liquidity: 510 },
      where: { id: PaymentMethod.BREB },
    })
    expect(response).toEqual({
      liquidity: 510,
      message: 'Liquidity retrieved successfully',
      success: true,
    })
  })

  it('returns failure response when liquidity retrieval fails', async () => {
    const { dbProvider, logger, useCase } = buildUseCase()
    dbProvider.getClient.mockRejectedValueOnce(new Error('db down'))

    const response = await useCase.getLiquidity(PaymentMethod.BREB)

    expect(response).toEqual({
      liquidity: 0,
      message: 'db down',
      success: false,
    })
    expect(logger.error).toHaveBeenCalledWith('[PaymentUseCase] Failed to retrieve liquidity', 'db down')
  })

  it('delegates onboarding and reports errors cleanly', async () => {
    const paymentService = buildPaymentService({
      onboardUser: jest.fn(async ({ account }: { account: string }) => ({ message: `ok:${account}`, success: true })),
    })
    const { logger, paymentServiceFactory, useCase } = buildUseCase({ paymentService })

    const response = await useCase.onboardUser('12345', PaymentMethod.BREB)
    expect(paymentServiceFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.BREB)
    expect(response).toEqual({ message: 'ok:12345', success: true })

    paymentService.onboardUser.mockRejectedValueOnce(new Error('onboard failure'))
    const failure = await useCase.onboardUser('abc', PaymentMethod.BREB)
    expect(failure).toEqual({ message: 'onboard failure', success: false })
    expect(logger.error).toHaveBeenCalledWith('[PaymentUseCase] Failed to onboard user', 'onboard failure')
  })
})
