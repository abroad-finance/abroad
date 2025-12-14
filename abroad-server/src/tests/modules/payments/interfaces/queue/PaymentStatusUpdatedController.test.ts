import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import type { IWalletHandlerFactory } from '../../../../../modules/payments/application/contracts/IWalletHandlerFactory'
import type { ISlackNotifier } from '../../../../../platform/notifications/ISlackNotifier'
import type { IWebhookNotifier } from '../../../../../platform/notifications/IWebhookNotifier'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { PaymentStatusUpdatedController } from '../../../../../modules/payments/interfaces/queue/PaymentStatusUpdatedController'
import { QueueName } from '../../../../../platform/messaging/queues'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../../setup/mockFactories'

type PrismaLike = {
  transaction: {
    update: jest.Mock
    updateMany: jest.Mock
  }
}

describe('PaymentStatusUpdatedController', () => {
  let logger: MockLogger
  let queueHandler: MockQueueHandler
  let dbProvider: jest.Mocked<IDatabaseClientProvider>
  let webhookNotifier: IWebhookNotifier
  let slackNotifier: ISlackNotifier
  let walletHandlerFactory: IWalletHandlerFactory
  let walletHandler: {
    getAddressFromTransaction: jest.Mock<Promise<string>>
    send: jest.Mock<Promise<{ success: boolean, transactionId?: string }>>
  }
  let prisma: PrismaLike
  let controller: PaymentStatusUpdatedController

  beforeEach(() => {
    logger = createMockLogger()
    queueHandler = createMockQueueHandler()
    prisma = {
      transaction: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    }
    dbProvider = {
      getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
    }
    webhookNotifier = {
      notifyWebhook: jest.fn(async () => undefined),
    }
    slackNotifier = {
      sendMessage: jest.fn(async () => undefined),
    }
    walletHandler = {
      getAddressFromTransaction: jest.fn(async () => 'refund-target'),
      send: jest.fn(async () => ({ success: true, transactionId: 'refund-123' })),
    }
    walletHandlerFactory = {
      getWalletHandler: jest.fn(() => walletHandler),
    } as unknown as IWalletHandlerFactory

    controller = new PaymentStatusUpdatedController(
      logger,
      queueHandler,
      dbProvider,
      webhookNotifier,
      slackNotifier,
      walletHandlerFactory,
    )
  })

  it('registers the consumer safely', () => {
    controller.registerConsumers()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.PAYMENT_STATUS_UPDATED,
      expect.any(Function),
    )
    expect(logger.info).toHaveBeenCalled()
  })

  it('maps provider statuses to internal statuses', () => {
    const mapper = controller as unknown as { mapProviderStatus: (status: string) => TransactionStatus }
    expect(mapper.mapProviderStatus('processed')).toBe(TransactionStatus.PAYMENT_COMPLETED)
    expect(mapper.mapProviderStatus('FAILED')).toBe(TransactionStatus.PAYMENT_FAILED)
    expect(mapper.mapProviderStatus('queued')).toBe(TransactionStatus.PROCESSING_PAYMENT)
    expect(mapper.mapProviderStatus('unknown')).toBe(TransactionStatus.PROCESSING_PAYMENT)
  })

  it('skips empty or malformed messages', async () => {
    const handler = controller as unknown as {
      onPaymentStatusUpdated: (msg: unknown) => Promise<void>
    }

    await handler.onPaymentStatusUpdated({})
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
    expect(dbProvider.getClient).not.toHaveBeenCalled()

    logger.error.mockClear()
    await handler.onPaymentStatusUpdated({ status: '' })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
  })

  it('ignores pending statuses without touching the database', async () => {
    const handler = controller as unknown as {
      onPaymentStatusUpdated: (msg: unknown) => Promise<void>
    }

    await handler.onPaymentStatusUpdated({
      currency: TargetCurrency.BRL,
      externalId: 'txn-1',
      provider: 'transfero',
      status: 'processing',
    })

    expect(dbProvider.getClient).toHaveBeenCalledTimes(1)
    expect(prisma.transaction.update).not.toHaveBeenCalled()
  })

  it('updates completed payments, notifies webhook and emits follow-up events', async () => {
    const handler = controller as unknown as {
      onPaymentStatusUpdated: (msg: unknown) => Promise<void>
    }
    prisma.transaction.update.mockResolvedValue({
      accountNumber: 'account-123',
      bankCode: 'bank-xyz',
      externalId: 'txn-1',
      id: 'txn-1',
      onChainId: 'on-chain-1',
      partnerUser: {
        partner: { id: 'partner-1', name: 'Partner', webhookUrl: 'http://hook' },
        userId: 'user-1',
      },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        id: 'quote-1',
        network: BlockchainNetwork.STELLAR,
        paymentMethod: PaymentMethod.NEQUI,
        sourceAmount: 100,
        targetAmount: 200,
        targetCurrency: TargetCurrency.COP,
      },
    })

    await handler.onPaymentStatusUpdated({
      currency: TargetCurrency.BRL,
      externalId: 'txn-1',
      provider: 'transfero',
      status: 'processed',
    })

    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: TransactionStatus.PAYMENT_COMPLETED },
      where: { externalId: 'txn-1' },
    }))
    expect(webhookNotifier.notifyWebhook).toHaveBeenCalledWith(
      'http://hook',
      expect.objectContaining({ event: 'transaction.updated' }),
    )
    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.USER_NOTIFICATION,
      expect.objectContaining({ type: 'transaction.updated' }),
    )
    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.PAYMENT_SENT,
      expect.objectContaining({
        cryptoCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.COP,
      }),
    )
    expect(slackNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Payment completed'))
    const [slackMessage] = (slackNotifier.sendMessage as jest.Mock).mock.calls[0] as [string]
    expect(slackMessage).toContain('Transaction: txn-1')
    expect(slackMessage).toContain('Quote: quote-1')
    expect(slackMessage).toContain('Payment: NEQUI')
    expect(slackMessage).toContain('Network: STELLAR')
    expect(slackMessage).toContain('References: External: txn-1')
    expect(slackMessage).toContain('Notes: provider: transfero | providerStatus: processed')
  })

  it('records failures and triggers refunds when hashes exist', async () => {
    const handler = controller as unknown as {
      onPaymentStatusUpdated: (msg: unknown) => Promise<void>
      recordRefundOnChainId: (
        prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
        transactionId: string,
        refundResult: { success: boolean, transactionId?: string },
      ) => Promise<void>
    }
    prisma.transaction.update.mockResolvedValue({
      accountNumber: 'account-123',
      bankCode: 'bank-xyz',
      externalId: 'txn-2',
      id: 'txn-2',
      onChainId: 'hash-1',
      partnerUser: {
        partner: { id: 'partner-1', name: 'Partner', webhookUrl: 'http://hook' },
        userId: 'user-2',
      },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        id: 'quote-2',
        network: BlockchainNetwork.STELLAR,
        paymentMethod: PaymentMethod.NEQUI,
        sourceAmount: 50,
        targetAmount: 90,
        targetCurrency: TargetCurrency.BRL,
      },
    })

    await handler.onPaymentStatusUpdated({
      currency: TargetCurrency.BRL,
      externalId: 'txn-2',
      provider: 'transfero',
      status: 'failed',
    })

    expect(walletHandlerFactory.getWalletHandler).toHaveBeenCalledWith(BlockchainNetwork.STELLAR)
    expect(walletHandler.getAddressFromTransaction).toHaveBeenCalledWith({ onChainId: 'hash-1' })
    expect(walletHandler.send).toHaveBeenCalledWith({
      address: 'refund-target',
      amount: 50,
      cryptoCurrency: CryptoCurrency.USDC,
    })
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      data: { refundOnChainId: 'refund-123' },
      where: { id: 'txn-2', refundOnChainId: null },
    })

    await handler.recordRefundOnChainId(
      await dbProvider.getClient(),
      'txn-3',
      { success: false },
    )
    expect(logger.warn).toHaveBeenCalledWith(
      '[PaymentStatusUpdated queue]: Refund transaction submission failed; no on-chain hash recorded',
      { transactionId: 'txn-3' },
    )
  })
})
