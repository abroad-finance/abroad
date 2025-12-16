import 'reflect-metadata'
import { PaymentMethod } from '@prisma/client'

import type { IPaymentUseCase } from '../../../../../modules/payments/application/paymentUseCase'

import { PaymentsController } from '../../../../../modules/payments/interfaces/http/PaymentsController'

describe('PaymentsController', () => {
  let paymentUseCase: jest.Mocked<IPaymentUseCase>
  let controller: PaymentsController

  beforeEach(() => {
    paymentUseCase = {
      getBanks: jest.fn(() => ({ banks: [{ bankCode: 101, bankName: 'Mock Bank' }] })),
      getLiquidity: jest.fn(async () => ({ liquidity: 75, message: 'ok', success: true })),
      onboardUser: jest.fn(async (account: string) => ({ message: `onboard:${account}`, success: true })),
    }

    controller = new PaymentsController(paymentUseCase)
  })

  it('returns banks from the payment use case', async () => {
    const result = await controller.getBanks(PaymentMethod.BREB)

    expect(paymentUseCase.getBanks).toHaveBeenCalledWith(PaymentMethod.BREB)
    expect(result.banks).toHaveLength(1)
  })

  it('returns an empty list and sets status 400 when fetching banks fails', async () => {
    paymentUseCase.getBanks.mockImplementation(() => {
      throw new Error('failure')
    })
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const result = await controller.getBanks(PaymentMethod.PIX)

    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(result.banks).toHaveLength(0)
  })

  it('returns liquidity from the use case and sets status when failing', async () => {
    paymentUseCase.getLiquidity.mockResolvedValueOnce({ liquidity: 12, message: 'ok', success: true })

    const successResponse = await controller.getLiquidity(PaymentMethod.PIX)
    expect(paymentUseCase.getLiquidity).toHaveBeenCalledWith(PaymentMethod.PIX)
    expect(successResponse.success).toBe(true)

    paymentUseCase.getLiquidity.mockResolvedValueOnce({ liquidity: 0, message: 'failure', success: false })
    const setStatusSpy = jest.spyOn(controller, 'setStatus')
    const failureResponse = await controller.getLiquidity(PaymentMethod.BREB)

    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(failureResponse).toEqual({ liquidity: 0, message: 'failure', success: false })
  })

  it('requires an account when onboarding a user', async () => {
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const response = await controller.onboardUser({ account: '' })

    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(response).toEqual({ message: 'Account is required', success: false })
    expect(paymentUseCase.onboardUser).not.toHaveBeenCalled()
  })

  it('delegates onboarding to the payment use case', async () => {
    paymentUseCase.onboardUser.mockResolvedValueOnce({ message: 'ok', success: true })
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const response = await controller.onboardUser({ account: '12345' })

    expect(paymentUseCase.onboardUser).toHaveBeenCalledWith('12345', PaymentMethod.BREB)
    expect(response).toEqual({ message: 'ok', success: true })
    expect(setStatusSpy).not.toHaveBeenCalled()
  })

  it('returns a 400 when onboarding fails', async () => {
    paymentUseCase.onboardUser.mockResolvedValueOnce({ message: 'onboard failure', success: false })
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    const response = await controller.onboardUser({ account: 'abc' })

    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(response).toEqual({ message: 'onboard failure', success: false })
  })
})
