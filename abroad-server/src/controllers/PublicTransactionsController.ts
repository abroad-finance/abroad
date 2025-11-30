// src/controllers/PublicTransactionsController.ts
import { BlockchainNetwork, CryptoCurrency, Partner, PartnerUser, Quote, Transaction, TransactionStatus } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import { inject } from 'inversify'
import {
  Controller,
  Post,
  Route,
  SuccessResponse,
} from 'tsoa'

import { ILogger, IQueueHandler, QueueName } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../interfaces/ISecretManager'
import { IWebhookNotifier, WebhookEvent } from '../interfaces/IWebhookNotifier'
import { TransactionQueueMessage } from './queue/ReceivedCryptoTransactionController'
import { TYPES } from '../types'

interface CheckExpiredTransactionsResponse {
  awaiting: number
  expired: number
  updated: number
  updatedTransactionIds: string[]
}

type TransactionWithRelations = Transaction & {
  partnerUser: PartnerUser & { partner: Partner }
  quote: Quote
}

interface CheckUnprocessedStellarResponse {
  alreadyProcessed: number
  endPagingToken: string | null
  enqueued: number
  missingTransactions: number
  scannedPayments: number
  startPagingToken: string | null
}

@Route('transactions')
export class PublicTransactionsController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IWebhookNotifier) private webhookNotifier: IWebhookNotifier,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) private logger: ILogger,
  ) {
    super()
  }

  /**
   * Checks all awaiting-payment transactions and marks expired ones as failed.
   * Returns how many were inspected and updated.
   */
  @Post('check-expired')
  @SuccessResponse('200', 'Expired transactions processed')
  public async checkExpiredTransactions(): Promise<CheckExpiredTransactionsResponse> {
    const prismaClient = await this.prismaClientProvider.getClient()
    const now = new Date()

    const totalAwaiting = await prismaClient.transaction.count({
      where: { status: TransactionStatus.AWAITING_PAYMENT },
    })

    const expiredTransactions = await prismaClient.transaction.findMany({
      include: {
        partnerUser: { include: { partner: true } },
        quote: true,
      },
      where: {
        quote: { expirationDate: { lt: now } },
        status: TransactionStatus.AWAITING_PAYMENT,
      },
    })

    if (expiredTransactions.length === 0) {
      this.logger.info('[PublicTransactionsController] No expired transactions found')
      return {
        awaiting: totalAwaiting,
        expired: 0,
        updated: 0,
        updatedTransactionIds: [],
      }
    }

    const updatedTransactions: TransactionWithRelations[] = []

    for (const transaction of expiredTransactions) {
      try {
        const result = await prismaClient.transaction.updateMany({
          data: { status: TransactionStatus.PAYMENT_EXPIRED },
          where: {
            id: transaction.id,
            status: TransactionStatus.AWAITING_PAYMENT,
          },
        })

        if (result.count === 0) {
          continue
        }

        updatedTransactions.push({
          ...transaction,
          status: TransactionStatus.PAYMENT_EXPIRED,
        })
      }
      catch (error) {
        this.logger.warn(
          '[PublicTransactionsController] Failed to mark transaction as expired',
          { error, transactionId: transaction.id },
        )
      }
    }

    await this.notifyUpdates(updatedTransactions)

    this.logger.info(
      '[PublicTransactionsController] Expired transactions processed',
      {
        processed: expiredTransactions.length,
        updated: updatedTransactions.length,
      },
    )

    return {
      awaiting: totalAwaiting,
      expired: expiredTransactions.length,
      updated: updatedTransactions.length,
      updatedTransactionIds: updatedTransactions.map((tx) => tx.id),
    }
  }

  /**
   * Scans Stellar payments since the last stored cursor and enqueues any missed transactions.
   */
  @Post('check-unprocessed-stellar')
  @SuccessResponse('200', 'Unprocessed Stellar transactions checked')
  public async checkUnprocessedStellarTransactions(): Promise<CheckUnprocessedStellarResponse> {
    const prismaClient = await this.prismaClientProvider.getClient()
    const state = await prismaClient.stellarListenerState.findUnique({ where: { id: 'singleton' } })
    const startPagingToken = state?.lastPagingToken ?? null

    if (!startPagingToken) {
      this.logger.warn('[PublicTransactionsController] No Stellar listener cursor found; skipping reconciliation run')
      return {
        alreadyProcessed: 0,
        endPagingToken: null,
        enqueued: 0,
        missingTransactions: 0,
        scannedPayments: 0,
        startPagingToken: null,
      }
    }

    const [accountId, horizonUrl, usdcIssuer] = await Promise.all([
      this.secretManager.getSecret(Secrets.STELLAR_ACCOUNT_ID),
      this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL),
      this.secretManager.getSecret(Secrets.STELLAR_USDC_ISSUER),
    ])

    const server = new Horizon.Server(horizonUrl)
    const pageSize = 200

    let cursor = startPagingToken
    let lastPersistedCursor = startPagingToken
    let scannedPayments = 0
    let enqueued = 0
    let alreadyProcessed = 0
    let missingTransactions = 0
    let haltProcessing = false

    while (!haltProcessing) {
      let request = server.payments().forAccount(accountId).order('asc').limit(pageSize)
      if (cursor) {
        request = request.cursor(cursor)
      }

      const page = await request.call()
      const records = page.records as Horizon.ServerApi.PaymentOperationRecord[]

      if (records.length === 0) {
        break
      }

      for (const payment of records) {
        scannedPayments += 1
        const currentToken = payment.paging_token

        if (!this.isUsdcPaymentToWallet(payment, accountId, usdcIssuer)) {
          lastPersistedCursor = currentToken
          continue
        }

        let transactionId: string
        try {
          const tx = await payment.transaction()

          if (!tx.memo) {
            lastPersistedCursor = currentToken
            continue
          }

          transactionId = PublicTransactionsController.base64ToUuid(tx.memo)
        }
        catch (error: unknown) {
          this.logger.error('[PublicTransactionsController] Failed to fetch/parse payment transaction', { error, paymentId: payment.id })
          haltProcessing = true
          break
        }

        const transaction = await prismaClient.transaction.findUnique({
          select: { id: true, onChainId: true, status: true },
          where: { id: transactionId },
        })

        if (!transaction) {
          missingTransactions += 1
          lastPersistedCursor = currentToken
          continue
        }

        if (transaction.status !== TransactionStatus.AWAITING_PAYMENT) {
          alreadyProcessed += 1
          lastPersistedCursor = currentToken
          continue
        }

        const queueMessage: TransactionQueueMessage = {
          addressFrom: payment.from,
          amount: parseFloat(payment.amount),
          blockchain: BlockchainNetwork.STELLAR,
          cryptoCurrency: CryptoCurrency.USDC,
          onChainId: payment.id,
          transactionId: transaction.id,
        }

        try {
          await this.queueHandler.postMessage(QueueName.RECEIVED_CRYPTO_TRANSACTION, queueMessage)
          enqueued += 1
          lastPersistedCursor = currentToken
        }
        catch (error: unknown) {
          this.logger.error('[PublicTransactionsController] Failed to enqueue recovered Stellar payment', {
            error,
            paymentId: payment.id,
            transactionId: transaction.id,
          })
          haltProcessing = true
          break
        }
      }

      cursor = lastPersistedCursor

      if (records.length < pageSize || haltProcessing) {
        break
      }
    }

    if (lastPersistedCursor && lastPersistedCursor !== startPagingToken) {
      const latestState = await prismaClient.stellarListenerState.findUnique({ where: { id: 'singleton' } })
      const currentToken = latestState?.lastPagingToken
      const shouldAdvanceCursor = !currentToken
        || BigInt(lastPersistedCursor) > BigInt(currentToken)

      if (shouldAdvanceCursor) {
        await prismaClient.stellarListenerState.upsert({
          create: { id: 'singleton', lastPagingToken: lastPersistedCursor },
          update: { lastPagingToken: lastPersistedCursor },
          where: { id: 'singleton' },
        })
      }
      else {
        this.logger.warn('[PublicTransactionsController] Skipped cursor update because a newer cursor already exists', {
          existingCursor: currentToken,
          proposedCursor: lastPersistedCursor,
        })
      }
    }

    return {
      alreadyProcessed,
      endPagingToken: lastPersistedCursor,
      enqueued,
      missingTransactions,
      scannedPayments,
      startPagingToken,
    }
  }

  private async notifyUpdates(transactions: TransactionWithRelations[]): Promise<void> {
    if (transactions.length === 0) {
      return
    }

    for (const transaction of transactions) {
      try {
        await this.webhookNotifier.notifyWebhook(
          transaction.partnerUser.partner.webhookUrl,
          { data: transaction, event: WebhookEvent.TRANSACTION_UPDATED },
        )
      }
      catch (error) {
        this.logger.warn(
          '[PublicTransactionsController] Failed to notify webhook for expired transaction',
          { error, transactionId: transaction.id },
        )
      }

      try {
        await this.queueHandler.postMessage(QueueName.USER_NOTIFICATION, {
          payload: JSON.stringify(transaction),
          type: 'transaction.updated',
          userId: transaction.partnerUser.userId,
        })
      }
      catch (error) {
        this.logger.warn(
          '[PublicTransactionsController] Failed to enqueue ws notification for expired transaction',
          { error, transactionId: transaction.id },
        )
      }
    }
  }

  private static base64ToUuid(base64: string): string {
    const buffer = Buffer.from(base64, 'base64')
    const hex = buffer.toString('hex')
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20),
    ].join('-')
  }

  private isUsdcPaymentToWallet(
    payment: Horizon.ServerApi.PaymentOperationRecord,
    accountId: string,
    usdcIssuer: string,
  ): boolean {
    const isUsdcAsset = payment.asset_type === 'credit_alphanum4'
      && payment.asset_code === 'USDC'
      && payment.asset_issuer === usdcIssuer

    return payment.to === accountId && isUsdcAsset
  }
}
