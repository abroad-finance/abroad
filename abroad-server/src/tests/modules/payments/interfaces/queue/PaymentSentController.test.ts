import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'

import { PaymentSentUseCase } from '../../../../../modules/payments/application/paymentSentUseCase'
import { PaymentSentController } from '../../../../../modules/payments/interfaces/queue/PaymentSentController'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../../setup/mockFactories'

const buildUseCaseHarness = () => {
  const logger: MockLogger = createMockLogger()
  const workflow = { handlePaymentSent: jest.fn() }
  const useCase = new PaymentSentUseCase(logger, workflow as never)
  return { logger, useCase, workflow }
}

describe('PaymentSentUseCase.process', () => {
  it('ignores empty or invalid messages', async () => {
    const { logger, useCase, workflow } = buildUseCaseHarness()

    await expect(useCase.process({})).rejects.toThrow(/Invalid payment sent message/)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )

    await expect(useCase.process({ amount: 10 })).rejects.toThrow(/Invalid payment sent message/)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
    expect(workflow.handlePaymentSent).not.toHaveBeenCalled()
  })

  it('delegates valid messages to the workflow', async () => {
    const { useCase, workflow } = buildUseCaseHarness()

    await useCase.process({
      amount: 25,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.BRL,
    })

    expect(workflow.handlePaymentSent).toHaveBeenCalledWith(expect.objectContaining({
      amount: 25,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    }))
  })
})

describe('PaymentSentController', () => {
  it('registers consumer and delegates to use case', async () => {
    const queueHandler: MockQueueHandler = createMockQueueHandler()
    const { useCase } = buildUseCaseHarness()
    const logger: MockLogger = createMockLogger()
    const controller = new PaymentSentController(logger, queueHandler, useCase)
    const processSpy = jest.spyOn(useCase, 'process')

    controller.registerConsumers()
    expect(queueHandler.subscribeToQueue).toHaveBeenCalled()

    const handler = queueHandler.subscribeToQueue.mock.calls[0][1]
    await handler({
      amount: 10,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.BRL,
    })
    expect(processSpy).toHaveBeenCalled()
  })
})
