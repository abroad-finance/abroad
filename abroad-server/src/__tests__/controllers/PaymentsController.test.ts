import 'reflect-metadata'
import { Country, PaymentMethod, TargetCurrency } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IPaymentService } from '../../interfaces/IPaymentService'
import type { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'

import { PaymentsController } from '../../controllers/PaymentsController'

type PaymentProviderModel = {
  update: jest.Mock<Promise<void>, [unknown]>
  upsert: jest.Mock<
    Promise<{ country: Country, id: PaymentMethod, liquidity: number, name: string }>,
    [unknown]
  >
}

type PrismaLike = {
  paymentProvider: PaymentProviderModel
}

const buildPaymentService = (
  overrides?: Partial<jest.Mocked<IPaymentService>>,
): jest.Mocked<IPaymentService> => ({
  banks: [{ bankCode: 101, bankName: 'Mock Bank' }],
  currency: TargetCurrency.COP,
  fixedFee: 0,
  getLiquidity: jest.fn(async () => 75),
  isAsync: false,
  MAX_TOTAL_AMOUNT_PER_DAY: 0,
  MAX_USER_AMOUNT_PER_DAY: 0,
  MAX_USER_AMOUNT_PER_TRANSACTION: 0,
  MAX_USER_TRANSACTIONS_PER_DAY: 0,
  onboardUser: jest.fn(async ({ account }: { account: string }) => ({ message: `onboarded:${account}`, success: true })),
  percentageFee: 0,
  sendPayment: jest.fn(async (params: {
    account: string
    bankCode: string
    id: string
    qrCode?: null | string
    value: number
  }) => ({ success: true, transactionId: `tx-${params.id}` })),
  verifyAccount: jest.fn(async ({ account, bankCode }: { account: string, bankCode: string }) => Boolean(account && bankCode)),
  ...(overrides ?? {}),
})

describe('PaymentsController', () => {
  let paymentService: jest.Mocked<IPaymentService>
  let paymentServiceFactory: jest.Mocked<IPaymentServiceFactory>
  let prismaClient: PrismaLike
  let dbProvider: IDatabaseClientProvider
  let controller: PaymentsController

  beforeEach(() => {
    paymentService = buildPaymentService()
    paymentServiceFactory = {
      getPaymentService: jest.fn<IPaymentService, [PaymentMethod]>(() => paymentService),
    }

    prismaClient = {
      paymentProvider: {
        update: jest.fn(),
        upsert: jest.fn(),
      },
    }

    dbProvider = {
      getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
    }

    controller = new PaymentsController(paymentServiceFactory, dbProvider)
  })

  it('returns banks using the default payment method when none is provided', async () => {
    const result = await controller.getBanks()

    expect(paymentServiceFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.MOVII)
    expect(result).toEqual({ banks: paymentService.banks })
  })

  it('returns an empty list and sets status 400 when fetching banks fails', async () => {
    paymentServiceFactory.getPaymentService.mockImplementation(() => {
      throw new Error('failure')
    })
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const result = await controller.getBanks(PaymentMethod.NEQUI)

    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(result.banks).toHaveLength(0)
  })

  it('returns persisted liquidity without calling the payment service', async () => {
    prismaClient.paymentProvider.upsert.mockResolvedValueOnce({
      country: Country.CO,
      id: PaymentMethod.NEQUI,
      liquidity: 250,
      name: PaymentMethod.NEQUI,
    })

    const setStatusSpy = jest.spyOn(controller, 'setStatus')
    const response = await controller.getLiquidity(PaymentMethod.NEQUI)

    expect(response).toEqual({
      liquidity: 250,
      message: 'Liquidity retrieved successfully',
      success: true,
    })
    expect(paymentService.getLiquidity).not.toHaveBeenCalled()
    expect(prismaClient.paymentProvider.update).not.toHaveBeenCalled()
    expect(setStatusSpy).not.toHaveBeenCalled()
  })

  it('fetches liquidity from the payment service when not cached', async () => {
    prismaClient.paymentProvider.upsert.mockResolvedValueOnce({
      country: Country.CO,
      id: PaymentMethod.MOVII,
      liquidity: 0,
      name: PaymentMethod.MOVII,
    })
    paymentService.getLiquidity.mockResolvedValueOnce(510)

    const response = await controller.getLiquidity()

    expect(paymentServiceFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.MOVII)
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

  it('returns a failure response when database access fails', async () => {
    (dbProvider.getClient as jest.Mock).mockRejectedValueOnce(new Error('db down'))
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const response = await controller.getLiquidity(PaymentMethod.NEQUI)

    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(response).toEqual({
      liquidity: 0,
      message: 'db down',
      success: false,
    })
  })

  it('requires an account when onboarding a user', async () => {
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const response = await controller.onboardUser({ account: '' })

    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(response).toEqual({ message: 'Account is required', success: false })
  })

  it('delegates onboarding to the payment service', async () => {
    paymentService.onboardUser.mockResolvedValueOnce({ message: 'ok', success: true })
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const response = await controller.onboardUser({ account: '12345' })

    expect(paymentServiceFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.MOVII)
    expect(paymentService.onboardUser).toHaveBeenCalledWith({ account: '12345' })
    expect(response).toEqual({ message: 'ok', success: true })
    expect(setStatusSpy).not.toHaveBeenCalled()
  })

  it('returns a 400 when onboarding fails', async () => {
    paymentService.onboardUser.mockRejectedValueOnce(new Error('onboard failure'))
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const response = await controller.onboardUser({ account: 'abc' })

    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(response).toEqual({ message: 'onboard failure', success: false })
  })
})
