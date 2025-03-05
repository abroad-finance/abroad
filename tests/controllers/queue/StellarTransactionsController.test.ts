// __tests__/StellarTransactionsController.spec.ts

import { StellarTransactionsController } from "../../../src/controllers/queue/StellarTransactionsController";
import {
  TransactionStatus,
  CryptoCurrency,
  BlockchainNetwork,
  PrismaClient,
} from "@prisma/client";
import {
  IPaymentService,
  IQueueHandler,
  ILogger,
  QueueName,
} from "../../../src/interfaces";
import { IDatabaseClientProvider } from "../../../src/interfaces/IDatabaseClientProvider";

// Define minimal interfaces for the parts of the Prisma client we need to mock.
interface MockPrismaTransaction {
  findFirst: jest.Mock<Promise<unknown>, [record: object]>;
  update: jest.Mock<Promise<unknown>, [record: object]>;
}

interface MockPrismaClient {
  $transaction: jest.Mock<
    Promise<unknown>,
    [
      (prisma: { transaction: MockPrismaTransaction }) => Promise<unknown>,
      { timeout: number },
    ]
  >;
  transaction: {
    update: jest.Mock<Promise<unknown>, [record: object]>;
  };
}

// Define a helper type to access the private method.
type StellarTransactionsControllerWithPrivate = {
  onTransactionReceived: (msg: Record<string, unknown>) => Promise<void>;
};

describe("StellarTransactionsController", () => {
  let paymentService: jest.Mocked<IPaymentService>;
  let queueHandler: jest.Mocked<IQueueHandler>;
  let dbClientProvider: jest.Mocked<IDatabaseClientProvider>;
  let logger: jest.Mocked<ILogger>;
  let controller: StellarTransactionsController;
  let prismaTransaction: MockPrismaTransaction;
  let prismaClient: PrismaClient;

  beforeEach(() => {
    // Create a mocked payment service.
    paymentService = {
      sendPayment: jest.fn(),
    };

    // Create a mocked logger.
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Create mocks for the Prisma transaction methods.
    prismaTransaction = {
      findFirst: jest.fn(),
      update: jest.fn(),
    };

    // Create a mocked Prisma client with a $transaction method and a transaction property.
    const partialPrismaClient: Partial<MockPrismaClient> = {
      $transaction: jest.fn(
        async (
          cb: (prisma: {
            transaction: MockPrismaTransaction;
          }) => Promise<unknown>,
          opts: { timeout: number },
        ) => {
          return await cb({ transaction: prismaTransaction });
        },
      ),
      transaction: {
        update: jest.fn(),
      },
    };

    // TODO: Create a mocked Prisma client with a $transaction method and a transaction property.
    prismaClient = partialPrismaClient as unknown as PrismaClient;

    // Create a mocked database client provider.
    dbClientProvider = {
      getClient: jest.fn(async () => prismaClient),
    };

    // Create a mocked queue handler.
    queueHandler = {
      subscribeToQueue: jest.fn(),
      postMessage: jest.fn(),
    };

    // Instantiate the controller with all mocked dependencies.
    controller = new StellarTransactionsController(
      paymentService,
      queueHandler,
      dbClientProvider,
      logger,
    );
  });

  describe("onTransactionReceived (private method)", () => {
    // Access the private method via a helper type.
    const invokeOnTransactionReceived = async (
      msg: Record<string, unknown>,
    ): Promise<void> => {
      return (
        controller as unknown as StellarTransactionsControllerWithPrivate
      ).onTransactionReceived(msg);
    };

    it("should log a warning and return if the message is empty", async () => {
      await invokeOnTransactionReceived({});
      expect(logger.warn).toHaveBeenCalledWith(
        "[Stellar transaction]: Received empty message. Skipping...",
      );
    });

    it("should log an error and return if the message is invalid", async () => {
      const invalidMsg = { invalid: "data" };
      await invokeOnTransactionReceived(invalidMsg);
      expect(logger.error).toHaveBeenCalled(); // Optionally, you could check for specific error details.
    });

    it("should warn if no matching transaction is found (or already processed)", async () => {
      const validMsg = {
        onChainId: "chain-123",
        amount: 100,
        transactionId: "11111111-1111-1111-1111-111111111111",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      // Simulate no transaction found in the DB transaction block.
      prismaTransaction.findFirst.mockResolvedValue(null);

      await invokeOnTransactionReceived(validMsg);
      expect(logger.warn).toHaveBeenCalledWith(
        "[Stellar transaction]: Transaction not found or already processed:",
        validMsg.transactionId,
      );
    });

    it("should update status to WRONG_AMOUNT when the message amount is less than the quote", async () => {
      const validMsg = {
        onChainId: "chain-123",
        amount: 50, // Less than expected source amount
        transactionId: "22222222-2222-2222-2222-222222222222",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      const transactionRecord = {
        id: validMsg.transactionId,
        onChainId: null,
        status: TransactionStatus.AWAITING_PAYMENT,
        accountNumber: "acc-001",
        quote: { sourceAmount: 100, targetAmount: 150 },
      };

      prismaTransaction.findFirst.mockResolvedValue(transactionRecord);

      await invokeOnTransactionReceived(validMsg);

      expect(logger.warn).toHaveBeenCalledWith(
        "[Stellar transaction]: Transaction amount does not match quote:",
        validMsg.amount,
        transactionRecord.quote.sourceAmount,
      );

      // Verify that the update outside the transaction is called to mark WRONG_AMOUNT.
      expect(prismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.WRONG_AMOUNT },
      });
    });

    it("should process payment successfully and update status to PAYMENT_COMPLETED", async () => {
      const validMsg = {
        onChainId: "chain-456",
        amount: 150, // Meets expected amount (>= sourceAmount)
        transactionId: "33333333-3333-3333-3333-333333333333",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      const transactionRecord = {
        id: validMsg.transactionId,
        onChainId: null,
        status: TransactionStatus.AWAITING_PAYMENT,
        accountNumber: "acc-002",
        quote: { sourceAmount: 100, targetAmount: 200 },
      };

      prismaTransaction.findFirst.mockResolvedValue(transactionRecord);
      paymentService.sendPayment.mockResolvedValue({ success: true });

      await invokeOnTransactionReceived(validMsg);

      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      });

      expect(prismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.PAYMENT_COMPLETED },
      });

      expect(logger.info).toHaveBeenCalledWith(
        `[Stellar transaction]: Payment completed for transaction:`,
        transactionRecord.id,
      );
    });

    it("should process payment failure and update status to PAYMENT_FAILED", async () => {
      const validMsg = {
        onChainId: "chain-789",
        amount: 150,
        transactionId: "44444444-4444-4444-4444-444444444444",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      const transactionRecord = {
        id: validMsg.transactionId,
        onChainId: null,
        status: TransactionStatus.AWAITING_PAYMENT,
        accountNumber: "acc-003",
        quote: { sourceAmount: 100, targetAmount: 200 },
      };

      prismaTransaction.findFirst.mockResolvedValue(transactionRecord);
      paymentService.sendPayment.mockResolvedValue({ success: false });

      await invokeOnTransactionReceived(validMsg);

      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      });

      expect(prismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.PAYMENT_FAILED },
      });

      expect(logger.info).toHaveBeenCalledWith(
        `[Stellar transaction]: Payment failed for transaction:`,
        transactionRecord.id,
      );
    });

    it("should handle payment errors and update status to PAYMENT_FAILED", async () => {
      const validMsg = {
        onChainId: "chain-101",
        amount: 150,
        transactionId: "55555555-5555-5555-5555-555555555555",
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
      };

      const transactionRecord = {
        id: validMsg.transactionId,
        onChainId: null,
        status: TransactionStatus.AWAITING_PAYMENT,
        accountNumber: "acc-004",
        quote: { sourceAmount: 100, targetAmount: 200 },
      };

      prismaTransaction.findFirst.mockResolvedValue(transactionRecord);
      paymentService.sendPayment.mockRejectedValue(new Error("Payment error"));

      await invokeOnTransactionReceived(validMsg);

      expect(paymentService.sendPayment).toHaveBeenCalledWith({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      });

      expect(logger.error).toHaveBeenCalledWith(
        "[Stellar transaction]: Payment processing error:",
        expect.any(Error),
      );

      expect(prismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.PAYMENT_FAILED },
      });
    });
  });

  describe("registerConsumers", () => {
    it("should subscribe to the correct queue with onTransactionReceived callback", () => {
      controller.registerConsumers();
      expect(logger.info).toHaveBeenCalledWith(
        "[Stellar transaction]: Registering consumer for queue:",
        QueueName.STELLAR_TRANSACTIONS,
      );
      expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
        QueueName.STELLAR_TRANSACTIONS,
        expect.any(Function),
      );
    });

    it("should log an error if subscribeToQueue throws an error", () => {
      const subscriptionError = new Error("Subscription error");
      queueHandler.subscribeToQueue.mockImplementation(() => {
        throw subscriptionError;
      });
      controller.registerConsumers();
      expect(logger.error).toHaveBeenCalledWith(
        "[Stellar transaction]: Error in consumer registration:",
        subscriptionError,
      );
    });
  });
});
