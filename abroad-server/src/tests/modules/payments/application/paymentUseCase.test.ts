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
  banks: [{ bankCode: 101, bankName: 'Mock Bank' }],
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
  it('returns banks for the resolved payment service', () => {
    const { paymentService, paymentServiceFactory, useCase } = buildUseCase()

    const result = useCase.getBanks(PaymentMethod.NEQUI)

    expect(paymentServiceFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.NEQUI)
    expect(result).toEqual({ banks: paymentService.banks })
  })

  it('throws when the payment service is disabled', () => {
    const paymentService = buildPaymentService({ isEnabled: false })
    const { useCase } = buildUseCase({
      paymentService,
      paymentServiceFactory: { getPaymentService: jest.fn<IPaymentService, [PaymentMethod]>(() => paymentService) } as jest.Mocked<IPaymentServiceFactory>,
    })

    expect(() => useCase.getBanks(PaymentMethod.MOVII)).toThrow(/unavailable/i)
  })

  it('returns cached liquidity without invoking the payment provider', async () => {
    const prismaClient: PrismaLike = {
      paymentProvider: {
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({
          country: Country.CO,
          id: PaymentMethod.NEQUI,
          liquidity: 250,
          name: PaymentMethod.NEQUI,
        }),
      },
    }
    const { paymentService, useCase } = buildUseCase({ prismaClient })

    const response = await useCase.getLiquidity(PaymentMethod.NEQUI)

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
          id: PaymentMethod.MOVII,
          liquidity: 0,
          name: PaymentMethod.MOVII,
        }),
      },
    }
    const paymentService = buildPaymentService({ getLiquidity: jest.fn(async () => 510) })
    const { useCase } = buildUseCase({ paymentService, prismaClient })

    const response = await useCase.getLiquidity()

    expect(paymentService.getLiquidity).toHaveBeenCalled()
    expect(prismaClient.paymentProvider.update).toHaveBeenCalledWith({
      data: { liquidity: 510 },
      where: { id: PaymentMethod.MOVII },
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

    const response = await useCase.getLiquidity(PaymentMethod.NEQUI)

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

    const response = await useCase.onboardUser('12345', PaymentMethod.MOVII)
    expect(paymentServiceFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.MOVII)
    expect(response).toEqual({ message: 'ok:12345', success: true })

    paymentService.onboardUser.mockRejectedValueOnce(new Error('onboard failure'))
    const failure = await useCase.onboardUser('abc', PaymentMethod.MOVII)
    expect(failure).toEqual({ message: 'onboard failure', success: false })
    expect(logger.error).toHaveBeenCalledWith('[PaymentUseCase] Failed to onboard user', 'onboard failure')
  })
})
