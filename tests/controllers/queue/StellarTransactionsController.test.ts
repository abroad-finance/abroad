import {
  BlockchainNetwork,
  CryptoCurrency,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

// __tests__/StellarTransactionsController.test.ts
import { StellarTransactionsController, TransactionQueueMessage } from '../../../src/controllers/queue/StellarTransactionsController'
import { ILogger, IQueueHandler, ISlackNotifier } from '../../../src/interfaces'
import { IDatabaseClientProvider } from '../../../src/interfaces/IDatabaseClientProvider'
import { IPaymentService } from '../../../src/interfaces/IPaymentService'
import { IPaymentServiceFactory } from '../../../src/interfaces/IPaymentServiceFactory'

describe('StellarTransactionsController', () => {
  let controller: StellarTransactionsController
  let paymentServiceFactory: jest.Mocked<IPaymentServiceFactory>
  let queueHandler: jest.Mocked<IQueueHandler>
  let dbClientProvider: jest.Mocked<IDatabaseClientProvider>
  let logger: jest.Mocked<ILogger>
  let prismaClient: { transaction: { update: jest.Mock } }
  let slackNotifier: jest.Mocked<ISlackNotifier>
  let paymentService: jest.Mocked<IPaymentService>

  // We capture the callback function registered via subscribeToQueue
  let capturedCallback: (msg: Record<string, unknown>) => void

  beforeEach(async () => {
    // Create typed mocks for the dependencies
    paymentService = {
      currency: TargetCurrency.COP,
      fixedFee: 0,
      percentageFee: 0,
      sendPayment: jest.fn(),
      verifyAccount: jest.fn(),
    }

    paymentServiceFactory = {
      getPaymentService: jest.fn().mockReturnValue(paymentService),
    }

    queueHandler = {
      postMessage: jest.fn(),
      subscribeToQueue: jest.fn(),
    }

    prismaClient = {
      transaction: {
        update: jest.fn(),
      },
    }

    dbClientProvider = {
      getClient: jest.fn().mockResolvedValue(prismaClient),
    }

    logger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }

    slackNotifier = {
      sendMessage: jest.fn(),
    }

    // Instantiate the controller with the mocks
    controller = new StellarTransactionsController(
      paymentServiceFactory,
      queueHandler,
      dbClientProvider,
      logger,
      slackNotifier,
    )

    // Call registerConsumers and capture the callback passed to subscribeToQueue
    controller.registerConsumers()
    expect(queueHandler.subscribeToQueue).toHaveBeenCalled()
    capturedCallback = queueHandler.subscribeToQueue.mock.calls[0][1] as (
      msg: Record<string, unknown>,
    ) => void

    // Clear any previous calls on mocks that might be set during consumer registration
    prismaClient.transaction.update.mockClear()
    logger.info.mockClear()
    logger.warn.mockClear()
    logger.error.mockClear()
  })
  describe('onTransactionReceived', () => {
    it('should log a warning and exit if an empty message is received', async () => {
      await capturedCallback({})
      expect(logger.warn).toHaveBeenCalledWith(
        '[Stellar transaction]: Received empty message. Skipping...',
      )
      expect(prismaClient.transaction.update).not.toHaveBeenCalled()
    })

    it('should log an error and exit for an invalid message format', async () => {
      // Provide a non-empty object that fails schema validation (missing required fields)
      const invalidMsg = { onChainId: 'chain-123' }
      await capturedCallback(invalidMsg)
      expect(logger.error).toHaveBeenCalled()
      expect(prismaClient.transaction.update).not.toHaveBeenCalled()
    })

    it('should update transaction status to WRONG_AMOUNT when message amount is less than quote.sourceAmount', async () => {
      const validMsg: TransactionQueueMessage = {
        amount: 50, // too low compared to quote.sourceAmount
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: 'chain-123',
        transactionId: '550e8400-e29b-41d4-a716-446655440000',
      }

      // Simulate the initial DB update returning a transaction record with a higher source amount
      const transactionRecord = {
        accountNumber: 'account-123',
        id: validMsg.transactionId,
        quote: {
          sourceAmount: 100,
          targetAmount: 90,
        },
      }
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord)

      await capturedCallback(validMsg)

      // Verify the first update call to mark the transaction as PROCESSING_PAYMENT
      expect(prismaClient.transaction.update).toHaveBeenCalledWith({
        data: {
          onChainId: validMsg.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
        include: { quote: true },
        where: {
          id: validMsg.transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })

      // Then a warning should be logged for the amount mismatch
      expect(logger.warn).toHaveBeenCalledWith(
        '[Stellar transaction]: Transaction amount does not match quote:',
        validMsg.amount,
        transactionRecord.quote.sourceAmount,
      )

      // And the transaction should be updated with WRONG_AMOUNT
      expect(prismaClient.transaction.update).toHaveBeenCalledWith({
        data: { status: TransactionStatus.WRONG_AMOUNT },
        where: { id: transactionRecord.id },
      })

      // Payment service should not be called
      expect(paymentService.sendPayment).not.toHaveBeenCalled()
    })

    it('should process payment and update transaction as PAYMENT_COMPLETED on successful payment', async () => {
      const validMsg: TransactionQueueMessage = {
        amount: 100,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: 'chain-456',
        transactionId: '550e8400-e29b-41d4-a716-446655440001',
      }

      const transactionRecord = {
        accountNumber: 'account-456',
        id: validMsg.transactionId,
        quote: {
          sourceAmount: 100,
          targetAmount: 95,
        },
      }

      // First DB update returns the transaction record
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord)
      // Simulate a successful payment
      paymentService.sendPayment.mockResolvedValueOnce({
        success: true,
        transactionId: 'tx-123',
      })
      // The final update call resolves as well (its return value is not used)
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord)

      await capturedCallback(validMsg)

      // Verify the initial update to PROCESSING_PAYMENT
      expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(1, {
        data: {
          onChainId: validMsg.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
        include: { quote: true },
        where: {
          id: validMsg.transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })

      // Check that the payment service is called with the proper parameters
      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      })

      // Verify that the final update sets the status to PAYMENT_COMPLETED
      expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(2, {
        data: { status: TransactionStatus.PAYMENT_COMPLETED },
        where: { id: transactionRecord.id },
      })

      // Confirm that an info log was issued indicating successful payment
      expect(logger.info).toHaveBeenCalledWith(
        '[Stellar transaction]: Payment completed for transaction:',
        transactionRecord.id,
      )
    })

    it('should process payment and update transaction as PAYMENT_FAILED on payment failure', async () => {
      const validMsg: TransactionQueueMessage = {
        amount: 100,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: 'chain-789',
        transactionId: '550e8400-e29b-41d4-a716-446655440002',
      }

      const transactionRecord = {
        accountNumber: 'account-789',
        id: validMsg.transactionId,
        quote: {
          sourceAmount: 100,
          targetAmount: 95,
        },
      }

      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord)
      // Simulate payment failure
      paymentService.sendPayment.mockResolvedValueOnce({ success: false })
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord)

      await capturedCallback(validMsg)

      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      })

      // Final update should set the status to PAYMENT_FAILED
      expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(2, {
        data: { status: TransactionStatus.PAYMENT_FAILED },
        where: { id: transactionRecord.id },
      })

      expect(logger.info).toHaveBeenCalledWith(
        '[Stellar transaction]: Payment failed for transaction:',
        transactionRecord.id,
      )
    })

    it('should catch payment processing errors and update transaction as PAYMENT_FAILED', async () => {
      const validMsg: TransactionQueueMessage = {
        amount: 100,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: 'chain-101',
        transactionId: '550e8400-e29b-41d4-a716-446655440003',
      }

      const transactionRecord = {
        accountNumber: 'account-101',
        id: validMsg.transactionId,
        quote: {
          sourceAmount: 100,
          targetAmount: 95,
        },
      }

      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord)
      const paymentError = new Error('Payment error')
      paymentService.sendPayment.mockRejectedValueOnce(paymentError)
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord)

      await capturedCallback(validMsg)

      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      })

      expect(logger.error).toHaveBeenCalledWith(
        '[Stellar transaction]: Payment processing error:',
        paymentError,
      )

      expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(2, {
        data: { status: TransactionStatus.PAYMENT_FAILED },
        where: { id: transactionRecord.id },
      })
    })

    it('should log a warning and exit if the transaction is not found (P2025 error)', async () => {
      const validMsg: TransactionQueueMessage = {
        amount: 100,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: 'chain-202',
        transactionId: '550e8400-e29b-41d4-a716-446655440004',
      }

      // Create a fake PrismaClientKnownRequestError with code "P2025"
      const notFoundError = new Error(
        'Not found',
      ) as Prisma.PrismaClientKnownRequestError
      Object.setPrototypeOf(
        notFoundError,
        Prisma.PrismaClientKnownRequestError.prototype,
      )
      notFoundError.code = 'P2025'

      prismaClient.transaction.update.mockRejectedValueOnce(notFoundError)

      await capturedCallback(validMsg)

      expect(logger.warn).toHaveBeenCalledWith(
        '[Stellar transaction]: Transaction not found or already processed:',
        validMsg.transactionId,
      )
    })
  })

  describe('registerConsumers', () => {
    it('should register the consumer and log info', () => {
      // Clear the previous subscribe mock for this test
      queueHandler.subscribeToQueue.mockClear()
      controller.registerConsumers()

      expect(logger.info).toHaveBeenCalledWith(
        '[Stellar transaction]: Registering consumer for queue:',
        'stellar-transactions',
      )
      expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
        'stellar-transactions',
        expect.any(Function),
      )
    })

    it('should log an error if subscribeToQueue throws', () => {
      const subscribeError = new Error('Subscribe error')
      queueHandler.subscribeToQueue.mockImplementationOnce(() => {
        throw subscribeError
      })

      controller.registerConsumers()

      expect(logger.error).toHaveBeenCalledWith(
        '[Stellar transaction]: Error in consumer registration:',
        subscribeError,
      )
    })
  })
})
