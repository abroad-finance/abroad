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

interface ControllerHarness {
  controller: ReceivedCryptoTransactionController
  handler: (msg: Record<string, boolean | number | string>) => Promise<void>
  logger: MockLogger
  paymentService: PaymentServiceMock
  paymentServiceFactory: IPaymentServiceFactory
  prismaClient: PrismaLike
  prismaProvider: jest.Mocked<IDatabaseClientProvider>
  queueHandler: MockQueueHandler
  slackNotifier: { sendMessage: jest.Mock }
  walletHandler: WalletHandlerMock
  walletHandlerFactory: IWalletHandlerFactory
  webhookNotifier: IWebhookNotifier
}

type PaymentServiceMock = IPaymentService & {
  sendPayment: jest.Mock<Promise<{ success: boolean, transactionId?: string }>>
}

type PrismaLike = {
  transaction: {
    findUnique: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
}

type WalletHandlerMock = IWalletHandler & { send: jest.Mock }

const message = {
  addressFrom: 'sender-wallet',
  amount: 50,
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  onChainId: 'on-chain-hash',
  transactionId: '11111111-1111-4111-8111-111111111111',
}

type ProcessingRecord = {
  accountNumber: string
  bankCode: string
  id: string
  partnerUser: {
    partner: { id: string, name: string, webhookUrl: string }
    userId: string
  }
  qrCode?: string
  quote: {
    cryptoCurrency: CryptoCurrency
    paymentMethod: PaymentMethod
    sourceAmount: number
    targetAmount: number
    targetCurrency: TargetCurrency
  }
  status: TransactionStatus
}

type ProcessingRecordOverrides = Partial<Omit<ProcessingRecord, 'partnerUser' | 'quote'>> & {
  partnerUser?: Partial<ProcessingRecord['partnerUser']> & {
    partner?: Partial<ProcessingRecord['partnerUser']['partner']>
  }
  quote?: Partial<ProcessingRecord['quote']>
}

function buildPaymentService(): PaymentServiceMock {
  return {
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
}

function buildPrismaClient(): PrismaLike {
  return {
    transaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  }
}

function buildProcessingRecord(overrides: ProcessingRecordOverrides = {}): ProcessingRecord {
  const base: ProcessingRecord = {
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
      targetCurrency: TargetCurrency.COP,
    },
    status: TransactionStatus.AWAITING_PAYMENT,
  }

  return {
    ...base,
    ...(overrides as Record<string, unknown>),
    partnerUser: {
      ...base.partnerUser,
      ...overrides.partnerUser,
      partner: {
        ...base.partnerUser.partner,
        ...(overrides.partnerUser?.partner ?? {}),
      },
    },
    quote: {
      ...base.quote,
      ...(overrides.quote ?? {}),
    },
  }
}

function buildWalletHandler(): WalletHandlerMock {
  return {
    getAddressFromTransaction: jest.fn(),
    send: jest.fn(async () => ({ success: true, transactionId: 'refund-123' })),
  }
}

function createControllerHarness(overrides: Partial<Omit<ControllerHarness, 'controller' | 'handler'>> = {}): ControllerHarness {
  const paymentService = overrides.paymentService ?? buildPaymentService()
  const paymentServiceFactory: IPaymentServiceFactory = overrides.paymentServiceFactory ?? {
    getPaymentService: jest.fn(() => paymentService),
  } as unknown as IPaymentServiceFactory
  const queueHandler = overrides.queueHandler ?? createMockQueueHandler()
  const prismaClient = overrides.prismaClient ?? buildPrismaClient()
  const prismaProvider: jest.Mocked<IDatabaseClientProvider> = overrides.prismaProvider ?? {
    getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
  }
  const walletHandler = overrides.walletHandler ?? buildWalletHandler()
  const walletHandlerFactory: IWalletHandlerFactory = overrides.walletHandlerFactory ?? {
    getWalletHandler: jest.fn(() => walletHandler),
  } as unknown as IWalletHandlerFactory
  const webhookNotifier = overrides.webhookNotifier ?? { notifyWebhook: jest.fn(async () => undefined) }
  const logger = overrides.logger ?? createMockLogger()
  const slackNotifier = overrides.slackNotifier ?? { sendMessage: jest.fn() }

  const controller = new ReceivedCryptoTransactionController(
    paymentServiceFactory,
    queueHandler,
    prismaProvider,
    logger,
    slackNotifier,
    walletHandlerFactory,
    webhookNotifier,
  )
  const handler = (msg: Record<string, boolean | number | string>) =>
    (controller as unknown as {
      onTransactionReceived: (msg: Record<string, boolean | number | string>) => Promise<void>
    }).onTransactionReceived(msg)

  return {
    controller,
    handler,
    logger,
    paymentService,
    paymentServiceFactory,
    prismaClient,
    prismaProvider,
    queueHandler,
    slackNotifier,
    walletHandler,
    walletHandlerFactory,
    webhookNotifier,
  }
}

describe('ReceivedCryptoTransactionController.onTransactionReceived', () => {
  it('ignores empty queue messages', async () => {
    const harness = createControllerHarness()

    await harness.handler({} as Record<string, boolean | number | string>)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]: Received empty message. Skipping...',
    )
    expect(harness.prismaProvider.getClient).not.toHaveBeenCalled()
  })

  it('refunds when the database client cannot be acquired', async () => {
    const harness = createControllerHarness()
    harness.prismaProvider.getClient.mockRejectedValueOnce(new Error('db down'))

    await harness.handler(message)

    expect(harness.logger.error).toHaveBeenCalled()
    expect(harness.walletHandlerFactory.getWalletHandler).toHaveBeenCalledWith(message.blockchain)
    expect(harness.walletHandler.send).toHaveBeenCalledWith({
      address: message.addressFrom,
      amount: message.amount,
      cryptoCurrency: message.cryptoCurrency,
    })
    expect(harness.queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('marks wrong amount transactions and triggers a refund', async () => {
    const harness = createControllerHarness()
    const processingRecord = buildProcessingRecord({
      quote: { sourceAmount: 100, targetAmount: 200 },
    })
    const wrongAmountRecord = { ...processingRecord, status: TransactionStatus.WRONG_AMOUNT }

    harness.prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(wrongAmountRecord)

    harness.prismaClient.transaction.findUnique.mockResolvedValue(wrongAmountRecord)

    await harness.controller['onTransactionReceived'](message)

    expect(harness.prismaClient.transaction.update).toHaveBeenNthCalledWith(
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

    expect(harness.prismaClient.transaction.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { status: TransactionStatus.WRONG_AMOUNT },
        where: { id: message.transactionId },
      }),
    )

    expect(harness.walletHandlerFactory.getWalletHandler).toHaveBeenCalledWith(message.blockchain)
    expect(harness.walletHandler.send).toHaveBeenCalledWith({
      address: message.addressFrom,
      amount: message.amount,
      cryptoCurrency: message.cryptoCurrency,
    })
    expect(harness.prismaClient.transaction.updateMany).toHaveBeenCalledWith({
      data: { refundOnChainId: 'refund-123' },
      where: { id: message.transactionId, refundOnChainId: null },
    })
    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(2)
  })

  it('completes synchronous payments and emits notifications', async () => {
    const harness = createControllerHarness()
    const processingRecord = buildProcessingRecord()
    const completedRecord = { ...processingRecord, status: TransactionStatus.PAYMENT_COMPLETED }
    const fullRecord = {
      ...completedRecord,
      quote: { ...completedRecord.quote, paymentMethod: PaymentMethod.NEQUI },
    }

    harness.paymentService.sendPayment.mockResolvedValueOnce({ success: true, transactionId: 'bank-123' })

    harness.prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(completedRecord)
    harness.prismaClient.transaction.findUnique.mockResolvedValue(fullRecord)

    await harness.handler({ ...message, amount: 50 })

    expect(harness.paymentService.sendPayment).toHaveBeenCalledWith({
      account: processingRecord.accountNumber,
      bankCode: processingRecord.bankCode,
      id: processingRecord.id,
      qrCode: processingRecord.qrCode,
      value: processingRecord.quote.targetAmount,
    })
    expect(harness.prismaClient.transaction.update).toHaveBeenCalledTimes(3)
    expect(harness.webhookNotifier.notifyWebhook).toHaveBeenCalledTimes(2)
    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(3)
    expect(harness.queueHandler.postMessage).toHaveBeenNthCalledWith(
      1,
      QueueName.USER_NOTIFICATION,
      expect.objectContaining({ userId: processingRecord.partnerUser.userId }),
    )
    expect(harness.queueHandler.postMessage).toHaveBeenNthCalledWith(
      2,
      QueueName.USER_NOTIFICATION,
      expect.objectContaining({ userId: processingRecord.partnerUser.userId }),
    )
    expect(harness.queueHandler.postMessage).toHaveBeenNthCalledWith(
      3,
      QueueName.PAYMENT_SENT,
      expect.objectContaining({
        amount: processingRecord.quote.sourceAmount,
        blockchain: BlockchainNetwork.STELLAR,
      }),
    )
    expect(harness.slackNotifier.sendMessage).toHaveBeenCalled()
    expect(harness.walletHandler.send).not.toHaveBeenCalled()
  })

  it('refunds and marks failure when payment submission fails', async () => {
    const harness = createControllerHarness()
    const processingRecord = buildProcessingRecord()

    harness.paymentService.sendPayment.mockRejectedValueOnce(new Error('gateway down'))
    harness.walletHandler.send = jest.fn(async () => ({ success: false }))

    harness.prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce({ ...processingRecord, status: TransactionStatus.PAYMENT_FAILED })
    harness.prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    await harness.handler({ ...message, amount: 75 })

    expect(harness.paymentService.sendPayment).toHaveBeenCalled()
    expect(harness.prismaClient.transaction.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: {
        onChainId: 'on-chain-hash',
        status: TransactionStatus.PROCESSING_PAYMENT,
      },
      where: { id: processingRecord.id, status: TransactionStatus.AWAITING_PAYMENT },
    }))
    expect(harness.prismaClient.transaction.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: { status: TransactionStatus.PAYMENT_FAILED },
      where: { id: processingRecord.id },
    }))
    expect(harness.walletHandler.send).toHaveBeenCalledWith({
      address: message.addressFrom,
      amount: 75,
      cryptoCurrency: message.cryptoCurrency,
    })
    expect(harness.prismaClient.transaction.updateMany).not.toHaveBeenCalled()
    expect(harness.slackNotifier.sendMessage).not.toHaveBeenCalled()
  })

  it('records failed payments and refunds when the provider responds with failure', async () => {
    const harness = createControllerHarness()
    const processingRecord = buildProcessingRecord()

    harness.paymentService.sendPayment.mockResolvedValueOnce({ success: false })
    harness.walletHandler.send = jest.fn(async () => ({ success: false }))

    harness.prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce({ ...processingRecord, status: TransactionStatus.PAYMENT_FAILED })
    harness.prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    await harness.handler({ ...message, amount: 60 })

    expect(harness.prismaClient.transaction.update).toHaveBeenCalledTimes(2)
    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(2)
    expect(harness.walletHandler.send).toHaveBeenCalled()
    expect(harness.slackNotifier.sendMessage).toHaveBeenCalled()
    expect(harness.prismaClient.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('registers the queue consumer and reports failures', () => {
    const harness = createControllerHarness()

    harness.controller.registerConsumers()
    expect(harness.logger.info).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]: Registering consumer for queue:',
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
    )
    expect(harness.queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      expect.any(Function),
    )

    const subscribeMock = harness.queueHandler.subscribeToQueue
    subscribeMock.mockImplementationOnce(() => {
      throw new Error('subscribe failure')
    })

    harness.controller.registerConsumers()
    expect(harness.logger.error).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]: Error in consumer registration:',
      expect.any(Error),
    )
  })

  it('rejects malformed messages before touching the database', async () => {
    const harness = createControllerHarness()

    await harness.handler({ transactionId: 'not-a-uuid' })

    expect(harness.logger.error).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]: Invalid message format:',
      expect.anything(),
    )
    expect(harness.prismaProvider.getClient).not.toHaveBeenCalled()
  })

  it('logs and exits when the transaction has already been processed', async () => {
    const notFoundError = new Prisma.PrismaClientKnownRequestError(
      'Not found',
      { clientVersion: 'test', code: 'P2025' },
    )
    const harness = createControllerHarness()
    harness.prismaClient.transaction.update.mockRejectedValueOnce(notFoundError)

    await harness.handler(message)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction]:STELLAR: Transaction not found or already processed:',
      message.transactionId,
    )
    expect(harness.queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('warns when websocket notifications fail during processing and refunds', async () => {
    const harness = createControllerHarness()
    const processingRecord = buildProcessingRecord({
      quote: { sourceAmount: 100, targetAmount: 200 },
    })
    const wrongAmountRecord = { ...processingRecord, status: TransactionStatus.WRONG_AMOUNT }

    const queueMock = harness.queueHandler.postMessage
    queueMock
      .mockRejectedValueOnce(new Error('processing notification failed'))
      .mockRejectedValueOnce(new Error('wrong amount notification failed'))

    harness.prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(wrongAmountRecord)
    harness.prismaClient.transaction.findUnique.mockResolvedValue(wrongAmountRecord)

    await harness.controller['onTransactionReceived'](message)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (processing)'),
      expect.any(Error),
    )
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (wrong amount)'),
      expect.any(Error),
    )
  })

  it('short-circuits for async payment providers after external id update', async () => {
    const paymentService = {
      ...buildPaymentService(),
      isAsync: true,
      sendPayment: jest.fn(async () => ({ success: true, transactionId: 'bank-async' })),
    }
    const harness = createControllerHarness({
      paymentService,
      paymentServiceFactory: { getPaymentService: jest.fn(() => paymentService) } as unknown as IPaymentServiceFactory,
    })

    const processingRecord = buildProcessingRecord()

    harness.prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
    harness.prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    await harness.handler(message)

    expect(paymentService.sendPayment).toHaveBeenCalled()
    expect(harness.prismaClient.transaction.update).toHaveBeenCalledTimes(2)
    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(1)
    expect(harness.slackNotifier.sendMessage).not.toHaveBeenCalled()
  })

  it('logs websocket failures after payment processing while continuing the workflow', async () => {
    const harness = createControllerHarness()
    const processingRecord = buildProcessingRecord()

    const completedRecord = { ...processingRecord, status: TransactionStatus.PAYMENT_COMPLETED }
    harness.prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(completedRecord)
    harness.prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    const queueMock = harness.queueHandler.postMessage
    queueMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('final ws failed'))
      .mockResolvedValueOnce(undefined)

    harness.paymentService.sendPayment.mockResolvedValueOnce({ success: true, transactionId: 'bank-123' })

    await harness.handler(message)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (final)'),
      expect.any(Error),
    )
    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(3)
    expect(harness.slackNotifier.sendMessage).toHaveBeenCalled()
  })

  it('warns when websocket publication fails after payment errors', async () => {
    const harness = createControllerHarness()
    const processingRecord = buildProcessingRecord()

    harness.paymentService.sendPayment.mockRejectedValueOnce(new Error('gateway down'))

    harness.prismaClient.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce({ ...processingRecord, status: TransactionStatus.PAYMENT_FAILED })

    harness.prismaClient.transaction.findUnique.mockResolvedValue(processingRecord)

    const queueMock = harness.queueHandler.postMessage
    queueMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('queue down'))

    await harness.handler(message)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (error)'),
      expect.any(Error),
    )
    expect(harness.walletHandler.send).toHaveBeenCalled()
  })

  it('logs persistence failures when recording refund hashes', async () => {
    const harness = createControllerHarness()
    const recorder = harness.controller as unknown as {
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

    expect(harness.logger.error).toHaveBeenCalledWith(
      '[ReceivedCryptoTransaction] Failed to persist refund transaction hash',
      expect.any(Error),
    )
  })
})
