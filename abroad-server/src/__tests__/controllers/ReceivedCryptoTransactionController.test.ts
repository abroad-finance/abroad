import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '.prisma/client'

import { ReceivedCryptoTransactionController } from '../../controllers/queue/ReceivedCryptoTransactionController'
import { QueueName } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { IPaymentService } from '../../interfaces/IPaymentService'
import { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'
import { IWalletHandler } from '../../interfaces/IWalletHandler'
import { IWalletHandlerFactory } from '../../interfaces/IWalletHandlerFactory'
import { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../setup/mockFactories'

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
  let prismaProvider: jest.Mocked<IDatabaseClientProvider>
  let queueHandler: MockQueueHandler
  let paymentServiceFactory: IPaymentServiceFactory
  let paymentService: IPaymentService & {
    sendPayment: jest.Mock<Promise<{ success: boolean, transactionId?: string }>>
  }
  let walletHandlerFactory: IWalletHandlerFactory
  let walletHandler: IWalletHandler
  let webhookNotifier: IWebhookNotifier
  let logger: MockLogger
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
    }

    queueHandler = createMockQueueHandler()

    paymentService = {
      banks: [],
      currency: 'COP' as TargetCurrency,
      fixedFee: 0,
      getLiquidity: jest.fn(async () => 0),
      isAsync: false,
      MAX_TOTAL_AMOUNT_PER_DAY: 1000,
      MAX_USER_AMOUNT_PER_DAY: 900,
      MAX_USER_AMOUNT_PER_TRANSACTION: 500,
      MAX_USER_TRANSACTIONS_PER_DAY: 5,
      onboardUser: jest.fn(),
      percentageFee: 0,
      sendPayment: jest.fn(),
      verifyAccount: jest.fn(async () => true),
    }

    paymentServiceFactory = {
      getPaymentService: jest.fn(() => paymentService),
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

    logger = createMockLogger()

    slackNotifier = { sendMessage: jest.fn() }
  })

  it('ignores empty queue messages', async () => {
    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived({} as Record<string, boolean | number | string>)

    expect(logger.warn).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]: Received empty message. Skipping...',
    )
    expect(prismaProvider.getClient).not.toHaveBeenCalled()
  })

  it('refunds when the database client cannot be acquired', async () => {
    const getClientMock = prismaProvider.getClient
    getClientMock.mockRejectedValueOnce(new Error('db down'))

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived(message)

    expect(logger.error).toHaveBeenCalled()
    expect(walletHandlerFactory.getWalletHandler).toHaveBeenCalledWith(message.blockchain)
    expect(walletHandler.send).toHaveBeenCalledWith({
      address: message.addressFrom,
      amount: message.amount,
      cryptoCurrency: message.cryptoCurrency,
    })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
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

  it('completes synchronous payments and emits notifications', async () => {
    const processingRecord = {
      accountNumber: '123',
      bankCode: 'bank',
      id: message.transactionId,
      partnerUser: {
        partner: { id: 'partner-id', name: 'Partner', webhookUrl: 'http://webhook' },
        userId: 'user-1',
      },
      qrCode: 'qr-code',
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        paymentMethod: PaymentMethod.NEQUI,
        sourceAmount: 50,
        targetAmount: 200,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    }

    const completedRecord = { ...processingRecord, status: TransactionStatus.PAYMENT_COMPLETED }
    const fullRecord = { ...completedRecord, quote: { ...completedRecord.quote, paymentMethod: PaymentMethod.NEQUI } }

    paymentService.sendPayment.mockResolvedValueOnce({ success: true, transactionId: 'bank-123' })

    prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(completedRecord)
    prismaClient.transaction.findUnique.mockResolvedValue(fullRecord)

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived({ ...message, amount: 50 })

    expect(paymentService.sendPayment).toHaveBeenCalledWith({
      account: processingRecord.accountNumber,
      bankCode: processingRecord.bankCode,
      id: processingRecord.id,
      qrCode: processingRecord.qrCode,
      value: processingRecord.quote.targetAmount,
    })
    expect(prismaClient.transaction.update).toHaveBeenCalledTimes(3)
    expect(webhookNotifier.notifyWebhook).toHaveBeenCalledTimes(2)
    expect(queueHandler.postMessage).toHaveBeenCalledTimes(3)
    expect(queueHandler.postMessage).toHaveBeenNthCalledWith(
      1,
      QueueName.USER_NOTIFICATION,
      expect.objectContaining({ userId: processingRecord.partnerUser.userId }),
    )
    expect(queueHandler.postMessage).toHaveBeenNthCalledWith(
      2,
      QueueName.USER_NOTIFICATION,
      expect.objectContaining({ userId: processingRecord.partnerUser.userId }),
    )
    expect(queueHandler.postMessage).toHaveBeenNthCalledWith(
      3,
      QueueName.PAYMENT_SENT,
      expect.objectContaining({
        amount: processingRecord.quote.sourceAmount,
        blockchain: BlockchainNetwork.STELLAR,
      }),
    )
    expect(slackNotifier.sendMessage).toHaveBeenCalled()
    expect(walletHandler.send).not.toHaveBeenCalled()
  })

  it('refunds and marks failure when payment submission fails', async () => {
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
        sourceAmount: 50,
        targetAmount: 200,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    }

    paymentService.sendPayment.mockRejectedValueOnce(new Error('gateway down'))
    walletHandler.send = jest.fn(async () => ({ success: false }))

    prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce({ ...processingRecord, status: TransactionStatus.PAYMENT_FAILED })
    prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived({ ...message, amount: 75 })

    expect(paymentService.sendPayment).toHaveBeenCalled()
    expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: {
        onChainId: 'on-chain-hash',
        status: TransactionStatus.PROCESSING_PAYMENT,
      },
      where: { id: processingRecord.id, status: TransactionStatus.AWAITING_PAYMENT },
    }))
    expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: { status: TransactionStatus.PAYMENT_FAILED },
      where: { id: processingRecord.id },
    }))
    expect(walletHandler.send).toHaveBeenCalledWith({
      address: message.addressFrom,
      amount: 75,
      cryptoCurrency: message.cryptoCurrency,
    })
    expect(prismaClient.transaction.updateMany).not.toHaveBeenCalled()
    expect(slackNotifier.sendMessage).not.toHaveBeenCalled()
  })

  it('records failed payments and refunds when the provider responds with failure', async () => {
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
        sourceAmount: 50,
        targetAmount: 200,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    }

    paymentService.sendPayment.mockResolvedValueOnce({ success: false })
    walletHandler.send = jest.fn(async () => ({ success: false }))

    prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce({ ...processingRecord, status: TransactionStatus.PAYMENT_FAILED })
    prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived({ ...message, amount: 60 })

    expect(prismaClient.transaction.update).toHaveBeenCalledTimes(2)
    expect(queueHandler.postMessage).toHaveBeenCalledTimes(2)
    expect(walletHandler.send).toHaveBeenCalled()
    expect(slackNotifier.sendMessage).toHaveBeenCalled()
    expect(prismaClient.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('registers the queue consumer and reports failures', () => {
    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )

    controller.registerConsumers()
    expect(logger.info).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]: Registering consumer for queue:',
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
    )
    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      expect.any(Function),
    )

    const subscribeMock = queueHandler.subscribeToQueue
    subscribeMock.mockImplementationOnce(() => {
      throw new Error('subscribe failure')
    })

    controller.registerConsumers()
    expect(logger.error).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]: Error in consumer registration:',
      expect.any(Error),
    )
  })

  it('rejects malformed messages before touching the database', async () => {
    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived({ transactionId: 'not-a-uuid' })

    expect(logger.error).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]: Invalid message format:',
      expect.anything(),
    )
    expect(prismaProvider.getClient).not.toHaveBeenCalled()
  })

  it('logs and exits when the transaction has already been processed', async () => {
    const notFoundError = new Prisma.PrismaClientKnownRequestError(
      'Not found',
      { clientVersion: 'test', code: 'P2025' },
    )
    prismaClient.transaction.update.mockRejectedValueOnce(notFoundError)

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived(message)

    expect(logger.warn).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]:STELLAR: Transaction not found or already processed:',
      message.transactionId,
    )
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('warns when websocket notifications fail during processing and refunds', async () => {
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

    const queueMock = queueHandler.postMessage
    queueMock
      .mockRejectedValueOnce(new Error('processing notification failed'))
      .mockRejectedValueOnce(new Error('wrong amount notification failed'))

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

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (processing)'),
      expect.any(Error),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (wrong amount)'),
      expect.any(Error),
    )
  })

  it('short-circuits for async payment providers after external id update', async () => {
    paymentService = {
      ...paymentService,
      isAsync: true,
      sendPayment: jest.fn(async () => ({ success: true, transactionId: 'bank-async' })),
    }
    paymentServiceFactory = {
      getPaymentService: jest.fn(() => paymentService),
    } as unknown as IPaymentServiceFactory

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
        sourceAmount: 50,
        targetAmount: 200,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    }

    prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
    prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived(message)

    expect(paymentService.sendPayment).toHaveBeenCalled()
    expect(prismaClient.transaction.update).toHaveBeenCalledTimes(2)
    expect(queueHandler.postMessage).toHaveBeenCalledTimes(1)
    expect(slackNotifier.sendMessage).not.toHaveBeenCalled()
  })

  it('logs websocket failures after payment processing while continuing the workflow', async () => {
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
        sourceAmount: 50,
        targetAmount: 200,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    }

    const completedRecord = { ...processingRecord, status: TransactionStatus.PAYMENT_COMPLETED }
    prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(completedRecord)
    prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    const queueMock = queueHandler.postMessage
    queueMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('final ws failed'))
      .mockResolvedValueOnce(undefined)

    paymentService.sendPayment.mockResolvedValueOnce({ success: true, transactionId: 'bank-123' })

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived(message)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (final)'),
      expect.any(Error),
    )
    expect(queueHandler.postMessage).toHaveBeenCalledTimes(3)
    expect(slackNotifier.sendMessage).toHaveBeenCalled()
  })

  it('warns when websocket publication fails after payment errors', async () => {
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
        sourceAmount: 50,
        targetAmount: 200,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    }

    paymentService.sendPayment.mockRejectedValueOnce(new Error('gateway down'))

    prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce({ ...processingRecord, status: TransactionStatus.PAYMENT_FAILED })

    prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    const queueMock = queueHandler.postMessage
    queueMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('queue down'))

    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const handler = controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }

    await handler.onTransactionReceived(message)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (error)'),
      expect.any(Error),
    )
    expect(walletHandler.send).toHaveBeenCalled()
  })

  it('logs persistence failures when recording refund hashes', async () => {
    const controller = new ReceivedCryptoTransactionController(
      paymentServiceFactory,
      queueHandler,
      prismaProvider,
      logger,
      slackNotifier,
      walletHandlerFactory,
      webhookNotifier,
    )
    const recorder = controller as unknown as {
      recordRefundOnChainId: (
        prisma: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
        transactionId: string,
        refundResult: { success: boolean, transactionId?: string },
      ) => Promise<void>
    }

    const prismaWithFailure = {
      transaction: {
        updateMany: jest.fn(async () => {
          throw new Error('persist failed')
        }),
      },
    } as unknown as Awaited<ReturnType<IDatabaseClientProvider['getClient']>>

    await recorder.recordRefundOnChainId(
      prismaWithFailure,
      'tx-1',
      { success: true, transactionId: 'refund-abc' },
    )

    expect(logger.error).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction] Failed to persist refund transaction hash',
      expect.any(Error),
    )
  })
})
