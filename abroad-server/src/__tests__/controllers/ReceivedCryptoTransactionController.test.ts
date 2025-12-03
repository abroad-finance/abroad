import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TransactionStatus } from '.prisma/client'

import { ReceivedCryptoTransactionController } from '../../controllers/queue/ReceivedCryptoTransactionController'
import { IQueueHandler } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'
import { IWalletHandler } from '../../interfaces/IWalletHandler'
import { IWalletHandlerFactory } from '../../interfaces/IWalletHandlerFactory'
import { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'

type PrismaLike = {
  transaction: {
    findUnique: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
}

describe('ReceivedCryptoTransactionController.onTransactionReceived', () => {
  const message = {
    addressFrom: 'sender-wallet',
    amount: 50,
    blockchain: BlockchainNetwork.STELLAR,
    cryptoCurrency: CryptoCurrency.USDC,
    onChainId: 'on-chain-hash',
    transactionId: '11111111-1111-4111-8111-111111111111',
  }

  let prismaClient: PrismaLike
  let prismaProvider: IDatabaseClientProvider
  let queueHandler: IQueueHandler
  let paymentServiceFactory: IPaymentServiceFactory
  let walletHandlerFactory: IWalletHandlerFactory
  let walletHandler: IWalletHandler
  let webhookNotifier: IWebhookNotifier
  let logger: { error: jest.Mock, info: jest.Mock, warn: jest.Mock }
  let slackNotifier: { sendMessage: jest.Mock }

  beforeEach(() => {
    prismaClient = {
      transaction: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    }
    prismaProvider = {
      getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider

    queueHandler = {
      postMessage: jest.fn(async () => undefined),
      subscribeToQueue: jest.fn(),
    } as IQueueHandler

    paymentServiceFactory = {
      getPaymentService: jest.fn(() => ({
        fixedFee: 0,
        getLiquidity: jest.fn(),
        isAsync: false,
        MAX_TOTAL_AMOUNT_PER_DAY: 1000,
        MAX_USER_AMOUNT_PER_TRANSACTION: 500,
        MAX_USER_TRANSACTIONS_PER_DAY: 5,
        sendPayment: jest.fn(),
        verifyAccount: jest.fn(),
      })),
    } as unknown as IPaymentServiceFactory

    walletHandler = {
      getAddressFromTransaction: jest.fn(),
      send: jest.fn(async () => ({ success: true, transactionId: 'refund-123' })),
    }

    walletHandlerFactory = {
      getWalletHandler: jest.fn(() => walletHandler),
    } as unknown as IWalletHandlerFactory

    webhookNotifier = {
      notifyWebhook: jest.fn(async () => undefined),
    }

    logger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }

    slackNotifier = { sendMessage: jest.fn() }
  })

  it('marks wrong amount transactions and triggers a refund', async () => {
    const processingRecord = {
      accountNumber: '123',
      bankCode: 'bank',
      id: message.transactionId,
      partnerUser: {
        partner: { id: 'partner-id', name: 'Partner', webhookUrl: 'http://webhook' },
        userId: 'user-1',
      },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        paymentMethod: PaymentMethod.NEQUI,
        sourceAmount: 100,
        targetAmount: 200,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    }

    const wrongAmountRecord = { ...processingRecord, status: TransactionStatus.WRONG_AMOUNT }

    prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(wrongAmountRecord)

    prismaClient.transaction.findUnique.mockResolvedValue(wrongAmountRecord)

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )

    await controller['onTransactionReceived'](message)

    expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: {
          onChainId: message.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
        where: {
          id: message.transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      }),
    )

    expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { status: TransactionStatus.WRONG_AMOUNT },
        where: { id: message.transactionId },
      }),
    )

    expect(walletHandlerFactory.getWalletHandler).toHaveBeenCalledWith(message.blockchain)
    expect(walletHandler.send).toHaveBeenCalledWith({
      address: message.addressFrom,
      amount: message.amount,
      cryptoCurrency: message.cryptoCurrency,
    })
    expect(prismaClient.transaction.updateMany).toHaveBeenCalledWith({
      data: { refundOnChainId: 'refund-123' },
      where: { id: message.transactionId, refundOnChainId: null },
    })
    expect(queueHandler.postMessage).toHaveBeenCalledTimes(2)
  })
})
