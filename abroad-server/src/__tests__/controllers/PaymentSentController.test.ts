import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'

import type { ISlackNotifier } from '../../interfaces'
import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IExchangeProviderFactory } from '../../interfaces/IExchangeProviderFactory'
import type { IWalletHandlerFactory } from '../../interfaces/IWalletHandlerFactory'

import { PaymentSentController } from '../../controllers/queue/PaymentSentController'
import { PaymentSentUseCase } from '../../useCases/paymentSentUseCase'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../setup/mockFactories'

type PrismaLike = {
  pendingConversions: {
    upsert: jest.Mock
  }
}

const buildUseCaseHarness = () => {
  const logger: MockLogger = createMockLogger()
  const dbClient: PrismaLike = { pendingConversions: { upsert: jest.fn() } }
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => dbClient as unknown as import('@prisma/client').PrismaClient),
  } as unknown as IDatabaseClientProvider
  const exchangeProviderFactory: IExchangeProviderFactory = {
    getExchangeProvider: jest.fn(() => ({
      getExchangeAddress: jest.fn(async () => ({ address: 'exchange-dest', memo: 'memo' })),
    })),
  } as unknown as IExchangeProviderFactory
  const walletHandler = {
    send: jest.fn(async () => ({ success: true, transactionId: 'on-chain-1' })),
  }
  const walletHandlerFactory: IWalletHandlerFactory = {
    getWalletHandler: jest.fn(() => walletHandler),
  } as unknown as IWalletHandlerFactory
  const slackNotifier: ISlackNotifier = { sendMessage: jest.fn() }

  const useCase = new PaymentSentUseCase(
    logger,
    walletHandlerFactory,
    slackNotifier,
    dbProvider,
    exchangeProviderFactory,
  )

  return {
    dbClient,
    dbProvider,
    exchangeProviderFactory,
    logger,
    slackNotifier,
    useCase,
    walletHandler,
    walletHandlerFactory,
  }
}

describe('PaymentSentUseCase.process', () => {
  it('ignores empty or invalid messages', async () => {
    const { logger, useCase } = buildUseCaseHarness()

    await useCase.process({})
    expect(logger.warn).toHaveBeenCalledWith(
      '[PaymentSent]: Received empty message. Skipping...',
    )

    await useCase.process({ amount: 10 })
    expect(logger.error).toHaveBeenCalledWith(
      '[PaymentSent]: Invalid message format:',
      expect.anything(),
    )
  })

  it('sends payments to the exchange and records pending conversions (COP)', async () => {
    const {
      dbClient,
      logger,
      useCase,
      walletHandler,
      walletHandlerFactory,
    } = buildUseCaseHarness()

    await useCase.process({
      amount: 50,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.NEQUI,
      targetCurrency: TargetCurrency.COP,
    })

    expect(walletHandlerFactory.getWalletHandler).toHaveBeenCalledWith(BlockchainNetwork.STELLAR)
    expect(walletHandler.send).toHaveBeenCalledWith({
      address: 'exchange-dest',
      amount: 50,
      cryptoCurrency: CryptoCurrency.USDC,
      memo: 'memo',
    })
    expect(dbClient.pendingConversions.upsert).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenCalledWith('[PaymentSent]: Payment sent successfully')
  })

  it('handles BRL settlement path and no-ops on failed wallet sends', async () => {
    const {
      dbClient,
      logger,
      slackNotifier,
      useCase,
      walletHandler,
    } = buildUseCaseHarness()
    walletHandler.send.mockResolvedValueOnce({ success: false, transactionId: 'err-1' })

    await useCase.process({
      amount: 25,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.NEQUI,
      targetCurrency: TargetCurrency.BRL,
    })

    expect(slackNotifier.sendMessage).toHaveBeenCalledWith(
      '[PaymentSent]: Error exchanging 25 USDC to BRL.',
    )
    expect(dbClient.pendingConversions.upsert).not.toHaveBeenCalled()
    logger.info.mockClear()

    walletHandler.send.mockResolvedValueOnce({ success: true, transactionId: 'hash-2' })
    await useCase.process({
      amount: 25,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.NEQUI,
      targetCurrency: TargetCurrency.BRL,
    })
    expect(dbClient.pendingConversions.upsert).toHaveBeenCalledTimes(1)
  })

  it('propagates failures and notifies slack when exchange handoff throws', async () => {
    const {
      logger,
      slackNotifier,
      useCase,
      walletHandlerFactory,
    } = buildUseCaseHarness()
    walletHandlerFactory.getWalletHandler = jest.fn(() => {
      throw new Error('wallet offline')
    }) as unknown as IWalletHandlerFactory['getWalletHandler']

    await expect(useCase.process({
      amount: 10,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.NEQUI,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('wallet offline')

    expect(logger.error).toHaveBeenCalledWith(
      '[PaymentSent]: Failed to process exchange handoff for 10 USDC to COP',
      expect.any(Error),
    )
    expect(slackNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('wallet offline'),
    )
  })
})

describe('PaymentSentController', () => {
  it('registers the consumer safely', () => {
    const logger: MockLogger = createMockLogger()
    const queueHandler: MockQueueHandler = createMockQueueHandler()
    const useCase = { process: jest.fn() } as unknown as PaymentSentUseCase
    const controller = new PaymentSentController(logger, queueHandler, useCase)

    controller.registerConsumers()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      '[PaymentSent]: Registering consumer for queue:',
      'payment-sent',
    )
  })
})
