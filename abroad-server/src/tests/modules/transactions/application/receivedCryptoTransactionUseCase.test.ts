import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import { IPaymentService } from '../../../../modules/payments/application/contracts/IPaymentService'
import { IPaymentServiceFactory } from '../../../../modules/payments/application/contracts/IPaymentServiceFactory'
import { IWalletHandler } from '../../../../modules/payments/application/contracts/IWalletHandler'
import { IWalletHandlerFactory } from '../../../../modules/payments/application/contracts/IWalletHandlerFactory'
import { ReceivedCryptoTransactionUseCase } from '../../../../modules/transactions/application/receivedCryptoTransactionUseCase'
import { ReceivedCryptoTransactionController } from '../../../../modules/transactions/interfaces/queue/ReceivedCryptoTransactionController'
import { QueueName, ReceivedCryptoTransactionMessage } from '../../../../platform/messaging/queues'
import { IWebhookNotifier } from '../../../../platform/notifications/IWebhookNotifier'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../setup/mockFactories'

type Harness = {
  dbProvider: jest.Mocked<IDatabaseClientProvider>
  logger: MockLogger
  paymentService: PaymentServiceMock
  prisma: PrismaMock
  queueHandler: MockQueueHandler
  slackNotifier: { sendMessage: jest.Mock }
  useCase: ReceivedCryptoTransactionUseCase
  walletFactory: IWalletHandlerFactory
  walletHandler: WalletHandlerMock
  webhookNotifier: IWebhookNotifier
}

type PaymentServiceMock = IPaymentService & {
  sendPayment: jest.Mock<Promise<{ success: boolean, transactionId?: string }>>
}

type PrismaMock = {
  transaction: {
    findUnique: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
}

type TransactionOverrides = Partial<Omit<TransactionRecord, 'partnerUser' | 'quote'>> & {
  partnerUser?: Partial<TransactionRecord['partnerUser']> & {
    partner?: Partial<TransactionRecord['partnerUser']['partner']>
  }
  quote?: Partial<TransactionRecord['quote']>
}

type TransactionRecord = Prisma.TransactionGetPayload<{ include: { partnerUser: { include: { partner: true } }, quote: true } }>

type WalletHandlerMock = IWalletHandler & {
  send: jest.Mock<Promise<{ success: boolean, transactionId?: string }>>
}

const baseMessage: ReceivedCryptoTransactionMessage = {
  addressFrom: 'sender-wallet',
  amount: 50,
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  onChainId: 'on-chain-hash',
  transactionId: '11111111-1111-4111-8111-111111111111',
}

const buildTransaction = (overrides: TransactionOverrides = {}): TransactionRecord => {
  const base = {
    accountNumber: '123',
    bankCode: 'bank',
    externalId: 'external-1',
    id: baseMessage.transactionId,
    onChainId: baseMessage.onChainId,
    partnerUser: {
      partner: { id: 'partner-1', name: 'Partner', webhookUrl: 'http://webhook' },
      userId: 'user-1',
    },
    quote: {
      cryptoCurrency: CryptoCurrency.USDC,
      id: 'quote-1',
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      sourceAmount: 50,
      targetAmount: 100,
      targetCurrency: TargetCurrency.COP,
    },
    status: TransactionStatus.AWAITING_PAYMENT,
  }

  return {
    ...base,
    ...overrides,
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
  } as TransactionRecord
}

const createPaymentService = (overrides: Partial<PaymentServiceMock> = {}): PaymentServiceMock => ({
  currency: TargetCurrency.COP,
  fixedFee: 0,
  getLiquidity: jest.fn(async () => 0),
  isAsync: false,
  isEnabled: true,
  MAX_TOTAL_AMOUNT_PER_DAY: 1000,
  MAX_USER_AMOUNT_PER_DAY: 900,
  MAX_USER_AMOUNT_PER_TRANSACTION: 500,
  MAX_USER_TRANSACTIONS_PER_DAY: 5,
  MIN_USER_AMOUNT_PER_TRANSACTION: 0,
  onboardUser: jest.fn(),
  percentageFee: 0,
  sendPayment: jest.fn(),
  verifyAccount: jest.fn(async () => true),
  ...overrides,
})

const createHarness = (overrides: Partial<Harness> = {}): Harness => {
  const paymentService = overrides.paymentService ?? createPaymentService()
  const paymentServiceFactory: IPaymentServiceFactory = {
    getPaymentService: jest.fn(() => paymentService),
  }
  const queueHandler = overrides.queueHandler ?? createMockQueueHandler()
  const prisma: PrismaMock = overrides.prisma ?? {
    transaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  }
  const dbProvider: jest.Mocked<IDatabaseClientProvider> = overrides.dbProvider ?? {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const walletHandler: WalletHandlerMock = overrides.walletHandler ?? {
    getAddressFromTransaction: jest.fn(),
    send: jest.fn(async () => ({ success: true, transactionId: 'refund-1' })),
  }
  const walletFactory: IWalletHandlerFactory = overrides.walletFactory ?? {
    getWalletHandler: jest.fn(() => walletHandler),
  }
  const webhookNotifier: IWebhookNotifier = overrides.webhookNotifier ?? { notifyWebhook: jest.fn(async () => undefined) }
  const slackNotifier = overrides.slackNotifier ?? { sendMessage: jest.fn(async () => undefined) }
  const logger = overrides.logger ?? createMockLogger()

  const useCase = new ReceivedCryptoTransactionUseCase(
    paymentServiceFactory,
    queueHandler,
    dbProvider,
    logger,
    slackNotifier,
    walletFactory,
    webhookNotifier,
  )

  return {
    dbProvider,
    logger,
    paymentService,
    prisma,
    queueHandler,
    slackNotifier,
    useCase,
    walletFactory,
    walletHandler,
    webhookNotifier,
  }
}

describe('ReceivedCryptoTransactionUseCase', () => {
  it('rejects invalid messages before touching the database', async () => {
    const harness = createHarness()

    await harness.useCase.process({ transactionId: 'not-a-uuid' })

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
    expect(harness.dbProvider.getClient).not.toHaveBeenCalled()
  })

  it('refunds when the database client cannot be acquired', async () => {
    const harness = createHarness()
    harness.dbProvider.getClient.mockRejectedValueOnce(new Error('db down'))

    await harness.useCase.process(baseMessage)

    expect(harness.walletFactory.getWalletHandler).toHaveBeenCalledWith(baseMessage.blockchain)
    expect(harness.walletHandler.send).toHaveBeenCalledWith({
      address: baseMessage.addressFrom,
      amount: baseMessage.amount,
      cryptoCurrency: baseMessage.cryptoCurrency,
    })
    expect(harness.queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('marks wrong amount transactions and triggers a refund', async () => {
    const harness = createHarness()
    const processingRecord = buildTransaction({ quote: { sourceAmount: 100 } })
    const wrongAmountRecord = { ...processingRecord, status: TransactionStatus.WRONG_AMOUNT } as TransactionRecord

    harness.prisma.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(wrongAmountRecord)
    harness.prisma.transaction.updateMany.mockResolvedValueOnce(undefined)

    await harness.useCase.process(baseMessage)

    expect(harness.prisma.transaction.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { status: TransactionStatus.WRONG_AMOUNT },
        where: { id: baseMessage.transactionId },
      }),
    )
    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(2)
    expect(harness.walletHandler.send).toHaveBeenCalled()
    expect(harness.prisma.transaction.updateMany).toHaveBeenCalledWith({
      data: { refundOnChainId: 'refund-1' },
      where: { id: baseMessage.transactionId, refundOnChainId: null },
    })
  })

  it('logs and exits when the transaction was already processed', async () => {
    const harness = createHarness()
    const notFoundError = new Prisma.PrismaClientKnownRequestError(
      'Not found',
      { clientVersion: 'test', code: 'P2025' },
    )
    harness.prisma.transaction.update.mockRejectedValueOnce(notFoundError)

    await harness.useCase.process(baseMessage)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Transaction not found or already processed'),
      expect.objectContaining({
        context: expect.objectContaining({
          blockchain: baseMessage.blockchain,
          transactionId: baseMessage.transactionId,
        }),
      }),
      expect.objectContaining({ transactionId: baseMessage.transactionId }),
    )
    expect(harness.queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('records unexpected persistence errors and aborts processing', async () => {
    const harness = createHarness()
    harness.prisma.transaction.update.mockRejectedValueOnce(new Error('db error'))

    await harness.useCase.process(baseMessage)

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating transaction'),
      expect.objectContaining({
        context: expect.objectContaining({
          blockchain: baseMessage.blockchain,
          transactionId: baseMessage.transactionId,
        }),
      }),
      expect.any(Error),
    )
    expect(harness.queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('skips received crypto for non-expired transactions after processing conflicts', async () => {
    const harness = createHarness()
    const notFoundError = new Prisma.PrismaClientKnownRequestError(
      'Not found',
      { clientVersion: 'test', code: 'P2025' },
    )
    harness.prisma.transaction.update.mockRejectedValueOnce(notFoundError)
    harness.prisma.transaction.findUnique.mockResolvedValueOnce({
      id: baseMessage.transactionId,
      onChainId: baseMessage.onChainId,
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_COMPLETED,
    })

    await harness.useCase.process(baseMessage)

    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Skipping received crypto for non-expired transaction'),
      expect.objectContaining({
        context: expect.objectContaining({
          blockchain: baseMessage.blockchain,
          transactionId: baseMessage.transactionId,
        }),
      }),
      {
        status: TransactionStatus.PAYMENT_COMPLETED,
        transactionId: baseMessage.transactionId,
      },
    )
    expect(harness.walletHandler.send).not.toHaveBeenCalled()
  })

  it('refunds expired transactions and records late on-chain ids', async () => {
    const harness = createHarness()
    const notFoundError = new Prisma.PrismaClientKnownRequestError(
      'Not found',
      { clientVersion: 'test', code: 'P2025' },
    )
    harness.prisma.transaction.update.mockRejectedValueOnce(notFoundError)
    harness.prisma.transaction.findUnique.mockResolvedValueOnce({
      id: baseMessage.transactionId,
      onChainId: null,
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_EXPIRED,
    })
    harness.prisma.transaction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })

    await harness.useCase.process(baseMessage)

    expect(harness.prisma.transaction.updateMany).toHaveBeenNthCalledWith(1, {
      data: { onChainId: baseMessage.onChainId },
      where: { id: baseMessage.transactionId, onChainId: null },
    })
    expect(harness.prisma.transaction.updateMany).toHaveBeenNthCalledWith(2, {
      data: { refundOnChainId: 'refund-1' },
      where: { id: baseMessage.transactionId, refundOnChainId: null },
    })
    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Recorded on-chain id for expired transaction'),
      expect.objectContaining({
        context: expect.objectContaining({
          blockchain: baseMessage.blockchain,
          transactionId: baseMessage.transactionId,
        }),
      }),
      {
        onChainId: baseMessage.onChainId,
        transactionId: baseMessage.transactionId,
      },
    )
    expect(harness.walletHandler.send).toHaveBeenCalledWith({
      address: baseMessage.addressFrom,
      amount: baseMessage.amount,
      cryptoCurrency: baseMessage.cryptoCurrency,
    })
  })

  it('skips refunds for expired transactions that already have refunds', async () => {
    const harness = createHarness()
    const notFoundError = new Prisma.PrismaClientKnownRequestError(
      'Not found',
      { clientVersion: 'test', code: 'P2025' },
    )
    harness.prisma.transaction.update.mockRejectedValueOnce(notFoundError)
    harness.prisma.transaction.findUnique.mockResolvedValueOnce({
      id: baseMessage.transactionId,
      onChainId: baseMessage.onChainId,
      refundOnChainId: 'refund-existing',
      status: TransactionStatus.PAYMENT_EXPIRED,
    })

    await harness.useCase.process(baseMessage)

    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Expired transaction already refunded; skipping'),
      expect.objectContaining({
        context: expect.objectContaining({
          blockchain: baseMessage.blockchain,
          transactionId: baseMessage.transactionId,
        }),
      }),
      {
        refundOnChainId: 'refund-existing',
        transactionId: baseMessage.transactionId,
      },
    )
    expect(harness.walletHandler.send).not.toHaveBeenCalled()
    expect(harness.prisma.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('warns when expired transactions already have a different on-chain id', async () => {
    const harness = createHarness()
    const notFoundError = new Prisma.PrismaClientKnownRequestError(
      'Not found',
      { clientVersion: 'test', code: 'P2025' },
    )
    harness.prisma.transaction.update.mockRejectedValueOnce(notFoundError)
    harness.prisma.transaction.findUnique.mockResolvedValueOnce({
      id: baseMessage.transactionId,
      onChainId: 'existing-on-chain',
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_EXPIRED,
    })
    harness.prisma.transaction.updateMany.mockResolvedValueOnce({ count: 1 })

    await harness.useCase.process(baseMessage)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Expired transaction already has a different on-chain id'),
      expect.objectContaining({
        context: expect.objectContaining({
          blockchain: baseMessage.blockchain,
          transactionId: baseMessage.transactionId,
        }),
      }),
      {
        existingOnChainId: 'existing-on-chain',
        receivedOnChainId: baseMessage.onChainId,
        transactionId: baseMessage.transactionId,
      },
    )
    expect(harness.prisma.transaction.updateMany).toHaveBeenCalledWith({
      data: { refundOnChainId: 'refund-1' },
      where: { id: baseMessage.transactionId, refundOnChainId: null },
    })
    expect(harness.prisma.transaction.updateMany).not.toHaveBeenCalledWith({
      data: { onChainId: baseMessage.onChainId },
      where: { id: baseMessage.transactionId, onChainId: null },
    })
  })

  it('completes synchronous payments and emits notifications', async () => {
    const harness = createHarness()
    const processingRecord = buildTransaction()
    const completedRecord = { ...processingRecord, status: TransactionStatus.PAYMENT_COMPLETED } as TransactionRecord

    harness.paymentService.sendPayment.mockResolvedValueOnce({ success: true, transactionId: 'bank-123' })
    harness.prisma.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(completedRecord)

    await harness.useCase.process(baseMessage)

    expect(harness.prisma.transaction.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        data: { status: TransactionStatus.PAYMENT_COMPLETED },
        where: { id: processingRecord.id },
      }),
    )
    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(3)
    expect(harness.queueHandler.postMessage).toHaveBeenLastCalledWith(
      QueueName.PAYMENT_SENT,
      expect.objectContaining({
        amount: processingRecord.quote.sourceAmount,
        blockchain: processingRecord.quote.network,
      }),
    )
    expect(harness.slackNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Payment completed'))
    const [slackMessage] = harness.slackNotifier.sendMessage.mock.calls[0] as [string]
    expect(slackMessage).toContain(`Transaction: ${processingRecord.id}`)
    expect(slackMessage).toContain(`Quote: ${processingRecord.quote.id}`)
    expect(slackMessage).toContain(`Payment: ${processingRecord.quote.paymentMethod}`)
    expect(slackMessage).toContain(`Network: ${processingRecord.quote.network}`)
    expect(slackMessage).toContain(`Account: ${processingRecord.accountNumber}`)
    expect(slackMessage).toContain(`References: External: ${processingRecord.externalId}`)
    expect(harness.walletHandler.send).not.toHaveBeenCalled()
  })

  it('records payment failures and issues refunds on errors', async () => {
    const harness = createHarness()
    const processingRecord = buildTransaction()
    const failedRecord = { ...processingRecord, status: TransactionStatus.PAYMENT_FAILED } as TransactionRecord

    harness.paymentService.sendPayment.mockRejectedValueOnce(new Error('gateway down'))
    harness.prisma.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(failedRecord)
    harness.prisma.transaction.updateMany.mockResolvedValueOnce(undefined)

    await harness.useCase.process(baseMessage)

    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(2)
    expect(harness.prisma.transaction.updateMany).toHaveBeenCalledWith({
      data: { refundOnChainId: 'refund-1' },
      where: { id: processingRecord.id, refundOnChainId: null },
    })
    expect(harness.walletHandler.send).toHaveBeenCalled()
  })

  it('logs websocket publication failures while continuing the workflow', async () => {
    const postMessage = jest.fn()
    postMessage.mockRejectedValueOnce(new Error('ws down'))
    postMessage.mockResolvedValue(undefined)
    const harness = createHarness({
      queueHandler: createMockQueueHandler({
        postMessage: postMessage as unknown as MockQueueHandler['postMessage'],
      }),
    })
    const processingRecord = buildTransaction()
    const completedRecord = { ...processingRecord, status: TransactionStatus.PAYMENT_COMPLETED } as TransactionRecord

    harness.prisma.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(completedRecord)

    await harness.useCase.process(baseMessage)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish ws notification (processing)'),
      expect.objectContaining({
        context: expect.objectContaining({
          blockchain: baseMessage.blockchain,
          transactionId: baseMessage.transactionId,
        }),
      }),
      expect.any(Error),
    )
  })

  it('warns when webhook delivery fails', async () => {
    const harness = createHarness({
      webhookNotifier: {
        notifyWebhook: jest.fn(async () => {
          throw new Error('hook down')
        }),
      } as IWebhookNotifier,
    })
    const processingRecord = buildTransaction()
    const completedRecord = { ...processingRecord, status: TransactionStatus.PAYMENT_COMPLETED } as TransactionRecord
    harness.prisma.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(completedRecord)

    await harness.useCase.process(baseMessage)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to notify partner webhook (processing)'),
      expect.objectContaining({
        context: expect.objectContaining({
          blockchain: baseMessage.blockchain,
          transactionId: baseMessage.transactionId,
        }),
      }),
      expect.any(Error),
    )
  })

  it('short-circuits for async payment providers after external id update', async () => {
    const paymentService = createPaymentService({
      isAsync: true,
      sendPayment: jest.fn(async () => ({ success: true, transactionId: 'bank-async' })),
    })
    const harness = createHarness({ paymentService })
    const processingRecord = buildTransaction()

    harness.prisma.transaction.update
      .mockResolvedValueOnce(processingRecord)
      .mockResolvedValueOnce(processingRecord)

    await harness.useCase.process(baseMessage)

    expect(paymentService.sendPayment).toHaveBeenCalled()
    expect(harness.queueHandler.postMessage).toHaveBeenCalledTimes(1)
    expect(harness.slackNotifier.sendMessage).not.toHaveBeenCalled()
    expect(harness.prisma.transaction.update).toHaveBeenCalledTimes(2)
  })
})

describe('ReceivedCryptoTransactionController', () => {
  it('registers the queue consumer and logs failures', () => {
    const queueHandler = createMockQueueHandler()
    const logger = createMockLogger()
    const useCase = {
      process: jest.fn(async () => undefined),
    } as unknown as ReceivedCryptoTransactionUseCase

    const controller = new ReceivedCryptoTransactionController(queueHandler, logger, useCase)

    controller.registerConsumers()
    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      expect.any(Function),
    )

    const subscribeMock = queueHandler.subscribeToQueue as jest.Mock
    subscribeMock.mockImplementationOnce(() => {
      throw new Error('subscribe failure')
    })

    controller.registerConsumers()
    expect(logger.error).toHaveBeenCalled()
  })
})
