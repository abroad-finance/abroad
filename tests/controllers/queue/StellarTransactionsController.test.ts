// __tests__/StellarTransactionsController.test.ts
import {
  StellarTransactionsController,
  TransactionQueueMessage,
} from "../../../src/controllers/queue/StellarTransactionsController";
import {
  IQueueHandler,
  ILogger,
  ISlackNotifier,
} from "../../../src/interfaces";
import {
  TransactionStatus,
  CryptoCurrency,
  BlockchainNetwork,
  Prisma,
  TargetCurrency,
} from "@prisma/client";
import { IDatabaseClientProvider } from "../../../src/interfaces/IDatabaseClientProvider";
import { IPaymentServiceFactory } from "../../../src/interfaces/IPaymentServiceFactory";
import { IPaymentService } from "../../../src/interfaces/IPaymentService";

describe("StellarTransactionsController", () => {
  let controller: StellarTransactionsController;
  let paymentServiceFactory: jest.Mocked<IPaymentServiceFactory>;
  let queueHandler: jest.Mocked<IQueueHandler>;
  let dbClientProvider: jest.Mocked<IDatabaseClientProvider>;
  let logger: jest.Mocked<ILogger>;
  let prismaClient: { transaction: { update: jest.Mock } };
  let slackNotifier: jest.Mocked<ISlackNotifier>;
  let paymentService: jest.Mocked<IPaymentService>;

  // We capture the callback function registered via subscribeToQueue
  let capturedCallback: (msg: Record<string, unknown>) => void;

  beforeEach(async () => {
    // Create typed mocks for the dependencies
    paymentService = {
      sendPayment: jest.fn(),
      currency: TargetCurrency.COP,
      fixedFee: 0,
      percentageFee: 0,
      verifyAccount: jest.fn(),
    };

    paymentServiceFactory = {
      getPaymentService: jest.fn().mockReturnValue(paymentService),
    };

    queueHandler = {
      subscribeToQueue: jest.fn(),
      postMessage: jest.fn(),
    };

    prismaClient = {
      transaction: {
        update: jest.fn(),
      },
    };

    dbClientProvider = {
      getClient: jest.fn().mockResolvedValue(prismaClient),
    };

    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    slackNotifier = {
      sendMessage: jest.fn(),
    };

    // Instantiate the controller with the mocks
    controller = new StellarTransactionsController(
      paymentServiceFactory,
      queueHandler,
      dbClientProvider,
      logger,
      slackNotifier,
    );

    // Call registerConsumers and capture the callback passed to subscribeToQueue
    controller.registerConsumers();
    expect(queueHandler.subscribeToQueue).toHaveBeenCalled();
    capturedCallback = queueHandler.subscribeToQueue.mock.calls[0][1];

    // Clear any previous calls on mocks that might be set during consumer registration
    prismaClient.transaction.update.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  describe("onTransactionReceived", () => {
    it("should log a warning and exit if an empty message is received", async () => {
      await capturedCallback({});
      expect(logger.warn).toHaveBeenCalledWith(
        "[Stellar transaction]: Received empty message. Skipping...",
      );
      expect(prismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it("should log an error and exit for an invalid message format", async () => {
      // Provide a non-empty object that fails schema validation (missing required fields)
      const invalidMsg = { onChainId: "chain-123" };
      await capturedCallback(invalidMsg);
      expect(logger.error).toHaveBeenCalled();
      expect(prismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it("should update transaction status to WRONG_AMOUNT when message amount is less than quote.sourceAmount", async () => {
      const validMsg: TransactionQueueMessage = {
        onChainId: "chain-123",
        amount: 50, // too low compared to quote.sourceAmount
        transactionId: "550e8400-e29b-41d4-a716-446655440000",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      // Simulate the initial DB update returning a transaction record with a higher source amount
      const transactionRecord = {
        id: validMsg.transactionId,
        accountNumber: "account-123",
        quote: {
          sourceAmount: 100,
          targetAmount: 90,
        },
      };
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord);

      await capturedCallback(validMsg);

      // Verify the first update call to mark the transaction as PROCESSING_PAYMENT
      expect(prismaClient.transaction.update).toHaveBeenCalledWith({
        where: {
          id: validMsg.transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
        include: { quote: true },
        data: {
          onChainId: validMsg.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
      });

      // Then a warning should be logged for the amount mismatch
      expect(logger.warn).toHaveBeenCalledWith(
        "[Stellar transaction]: Transaction amount does not match quote:",
        validMsg.amount,
        transactionRecord.quote.sourceAmount,
      );

      // And the transaction should be updated with WRONG_AMOUNT
      expect(prismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.WRONG_AMOUNT },
      });

      // Payment service should not be called
      expect(paymentService.sendPayment).not.toHaveBeenCalled();
    });

    it("should process payment and update transaction as PAYMENT_COMPLETED on successful payment", async () => {
      const validMsg: TransactionQueueMessage = {
        onChainId: "chain-456",
        amount: 100,
        transactionId: "550e8400-e29b-41d4-a716-446655440001",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      const transactionRecord = {
        id: validMsg.transactionId,
        accountNumber: "account-456",
        quote: {
          sourceAmount: 100,
          targetAmount: 95,
        },
      };

      // First DB update returns the transaction record
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord);
      // Simulate a successful payment
      paymentService.sendPayment.mockResolvedValueOnce({
        success: true,
        transactionId: "tx-123",
      });
      // The final update call resolves as well (its return value is not used)
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord);

      await capturedCallback(validMsg);

      // Verify the initial update to PROCESSING_PAYMENT
      expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(1, {
        where: {
          id: validMsg.transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
        include: { quote: true },
        data: {
          onChainId: validMsg.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
      });

      // Check that the payment service is called with the proper parameters
      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      });

      // Verify that the final update sets the status to PAYMENT_COMPLETED
      expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(2, {
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.PAYMENT_COMPLETED },
      });

      // Confirm that an info log was issued indicating successful payment
      expect(logger.info).toHaveBeenCalledWith(
        "[Stellar transaction]: Payment completed for transaction:",
        transactionRecord.id,
      );
    });

    it("should process payment and update transaction as PAYMENT_FAILED on payment failure", async () => {
      const validMsg: TransactionQueueMessage = {
        onChainId: "chain-789",
        amount: 100,
        transactionId: "550e8400-e29b-41d4-a716-446655440002",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      const transactionRecord = {
        id: validMsg.transactionId,
        accountNumber: "account-789",
        quote: {
          sourceAmount: 100,
          targetAmount: 95,
        },
      };

      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord);
      // Simulate payment failure
      paymentService.sendPayment.mockResolvedValueOnce({ success: false });
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord);

      await capturedCallback(validMsg);

      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      });

      // Final update should set the status to PAYMENT_FAILED
      expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(2, {
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.PAYMENT_FAILED },
      });

      expect(logger.info).toHaveBeenCalledWith(
        "[Stellar transaction]: Payment failed for transaction:",
        transactionRecord.id,
      );
    });

    it("should catch payment processing errors and update transaction as PAYMENT_FAILED", async () => {
      const validMsg: TransactionQueueMessage = {
        onChainId: "chain-101",
        amount: 100,
        transactionId: "550e8400-e29b-41d4-a716-446655440003",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      const transactionRecord = {
        id: validMsg.transactionId,
        accountNumber: "account-101",
        quote: {
          sourceAmount: 100,
          targetAmount: 95,
        },
      };

      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord);
      const paymentError = new Error("Payment error");
      paymentService.sendPayment.mockRejectedValueOnce(paymentError);
      prismaClient.transaction.update.mockResolvedValueOnce(transactionRecord);

      await capturedCallback(validMsg);

      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      });

      expect(logger.error).toHaveBeenCalledWith(
        "[Stellar transaction]: Payment processing error:",
        paymentError,
      );

      expect(prismaClient.transaction.update).toHaveBeenNthCalledWith(2, {
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.PAYMENT_FAILED },
      });
    });

    it("should log a warning and exit if the transaction is not found (P2025 error)", async () => {
      const validMsg: TransactionQueueMessage = {
        onChainId: "chain-202",
        amount: 100,
        transactionId: "550e8400-e29b-41d4-a716-446655440004",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      // Create a fake PrismaClientKnownRequestError with code "P2025"
      const notFoundError = new Error(
        "Not found",
      ) as Prisma.PrismaClientKnownRequestError;
      Object.setPrototypeOf(
        notFoundError,
        Prisma.PrismaClientKnownRequestError.prototype,
      );
      notFoundError.code = "P2025";

      prismaClient.transaction.update.mockRejectedValueOnce(notFoundError);

      await capturedCallback(validMsg);

      expect(logger.warn).toHaveBeenCalledWith(
        "[Stellar transaction]: Transaction not found or already processed:",
        validMsg.transactionId,
      );
    });
  });

  describe("registerConsumers", () => {
    it("should register the consumer and log info", () => {
      // Clear the previous subscribe mock for this test
      queueHandler.subscribeToQueue.mockClear();
      controller.registerConsumers();

      expect(logger.info).toHaveBeenCalledWith(
        "[Stellar transaction]: Registering consumer for queue:",
        "stellar-transactions",
      );
      expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
        "stellar-transactions",
        expect.any(Function),
      );
    });

    it("should log an error if subscribeToQueue throws", () => {
      const subscribeError = new Error("Subscribe error");
      queueHandler.subscribeToQueue.mockImplementationOnce(() => {
        throw subscribeError;
      });

      controller.registerConsumers();

      expect(logger.error).toHaveBeenCalledWith(
        "[Stellar transaction]: Error in consumer registration:",
        subscribeError,
      );
    });
  });
});
