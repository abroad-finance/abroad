import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'

import type { ILogger, IQueueHandler, ISlackNotifier } from '../../interfaces'
import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IExchangeProviderFactory } from '../../interfaces/IExchangeProviderFactory'
import type { IWalletHandlerFactory } from '../../interfaces/IWalletHandlerFactory'

import { PaymentSentController } from '../../controllers/queue/PaymentSentController'

type PrismaLike = {
  pendingConversions: {
    upsert: jest.Mock
  }
}

const buildController = () => {
  const logger: jest.Mocked<ILogger> = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const queueHandler: IQueueHandler = {
    postMessage: jest.fn(),
    subscribeToQueue: jest.fn(),
  }
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

  const controller = new PaymentSentController(
    logger,
    queueHandler,
    walletHandlerFactory,
    slackNotifier,
    dbProvider,
    exchangeProviderFactory,
  )

  return {
    controller,
    dbClient,
    dbProvider,
    exchangeProviderFactory,
    logger,
    queueHandler,
    slackNotifier,
    walletHandler,
    walletHandlerFactory,
  }
}

describe('PaymentSentController', () => {
  it('registers the consumer safely', () => {
    const { controller, logger, queueHandler } = buildController()
    controller.registerConsumers()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      '[PaymentSent queue]: Registering consumer for queue:',
      'payment-sent',
    )
  })

  it('ignores empty or invalid messages', async () => {
    const { controller, logger } = buildController()
    const handler = controller as unknown as {
      onPaymentSent: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onPaymentSent({})
    expect(logger.warn).toHaveBeenCalledWith(
      '[PaymentSent queue]: Received empty message. Skipping...',
    )

    await handler.onPaymentSent({ amount: 10 })
    expect(logger.error).toHaveBeenCalledWith(
      '[PaymentSent queue]: Invalid message format:',
      expect.anything(),
    )
  })

  it('sends payments to the exchange and records pending conversions (COP)', async () => {
    const {
      controller,
      dbClient,
      logger,
      walletHandler,
      walletHandlerFactory,
    } = buildController()
    const handler = controller as unknown as {
      onPaymentSent: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onPaymentSent({
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
    expect(logger.info).toHaveBeenCalledWith('[PaymentSent Queue]: Payment sent successfully')
  })

  it('handles BRL settlement path and no-ops on failed wallet sends', async () => {
    const {
      controller,
      dbClient,
      logger,
      slackNotifier,
      walletHandler,
    } = buildController()
    walletHandler.send.mockResolvedValueOnce({ success: false, transactionId: 'err-1' })
    const handler = controller as unknown as {
      onPaymentSent: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onPaymentSent({
      amount: 25,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.NEQUI,
      targetCurrency: TargetCurrency.BRL,
    })

    expect(slackNotifier.sendMessage).toHaveBeenCalledWith(
      '[PaymentSent Queue]: Error exchanging 25 USDC to BRL.',
    )
    expect(dbClient.pendingConversions.upsert).not.toHaveBeenCalled()
    logger.info.mockClear()

    walletHandler.send.mockResolvedValueOnce({ success: true, transactionId: 'hash-2' })
    await handler.onPaymentSent({
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
      controller,
      logger,
      slackNotifier,
      walletHandlerFactory,
    } = buildController()
    walletHandlerFactory.getWalletHandler = jest.fn(() => {
      throw new Error('wallet offline')
    }) as unknown as IWalletHandlerFactory['getWalletHandler']
    const sender = controller as unknown as {
      sendToExchangeAndUpdatePendingConversions: (input: {
        amount: number
        blockchain: BlockchainNetwork
        cryptoCurrency: CryptoCurrency
        targetCurrency: TargetCurrency
      }) => Promise<void>
    }

    await expect(sender.sendToExchangeAndUpdatePendingConversions({
      amount: 10,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('wallet offline')

    expect(logger.error).toHaveBeenCalledWith(
      '[PaymentSent Queue]: Failed to process exchange handoff for 10 USDC to COP',
      expect.any(Error),
    )
    expect(slackNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('wallet offline'),
    )
  })
})
