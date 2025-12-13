import { BlockchainNetwork, CryptoCurrency, PrismaClient, TransactionStatus } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'

import { ILogger } from '../../../core/logging/types'
import { IQueueHandler, QueueName } from '../../../platform/messaging/queues'
import { ReceivedCryptoTransactionMessage } from '../../../platform/messaging/queueSchema'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'

export type CheckUnprocessedStellarResponse = {
  alreadyProcessed: number
  endPagingToken: null | string
  enqueued: number
  missingTransactions: number
  scannedPayments: number
  startPagingToken: null | string
}

type PaymentProcessingOutcome
  = | { cursor: string, result: 'alreadyProcessed' | 'enqueued' | 'irrelevant' | 'missing' }
    | { cursor: string, result: 'halt' }

type StellarReconciliationContext = {
  accountId: string
  prismaClient: PrismaClient
  server: Horizon.Server
  startPagingToken: string
  usdcIssuer: string
}

const STELLAR_PAGE_SIZE = 200

export class StellarReconciliationService {
  constructor(
    private readonly prismaProvider: IDatabaseClientProvider,
    private readonly secretManager: ISecretManager,
    private readonly queueHandler: IQueueHandler,
    private readonly logger: ILogger,
  ) {}

  public async reconcile(): Promise<CheckUnprocessedStellarResponse> {
    const prismaClient = await this.prismaProvider.getClient()
    const startPagingToken = await this.getStartPagingToken(prismaClient)

    if (!startPagingToken) {
      this.logger.warn('[PublicTransactionsController] No Stellar listener cursor found; skipping reconciliation run')
      return this.buildEmptySummary()
    }

    const { accountId, horizonUrl, usdcIssuer } = await this.getStellarSecrets()
    const server = new Horizon.Server(horizonUrl)

    const summary = await this.reconcileStellarPayments({
      accountId,
      prismaClient,
      server,
      startPagingToken,
      usdcIssuer,
    })

    await this.persistPagingToken(prismaClient, startPagingToken, summary.endPagingToken)

    return summary
  }

  private applyOutcome(
    summary: CheckUnprocessedStellarResponse,
    outcome: Exclude<PaymentProcessingOutcome, { result: 'halt' }>,
  ): void {
    switch (outcome.result) {
      case 'alreadyProcessed':
        summary.alreadyProcessed += 1
        break
      case 'enqueued':
        summary.enqueued += 1
        break
      case 'irrelevant':
        break
      case 'missing':
        summary.missingTransactions += 1
        break
      default:
        break
    }
  }

  private buildEmptySummary(): CheckUnprocessedStellarResponse {
    return {
      alreadyProcessed: 0,
      endPagingToken: null,
      enqueued: 0,
      missingTransactions: 0,
      scannedPayments: 0,
      startPagingToken: null,
    }
  }

  private async extractTransactionId(payment: Horizon.ServerApi.PaymentOperationRecord): Promise<null | string> {
    const transaction = await payment.transaction()
    const memo = transaction.memo

    if (!memo) {
      return null
    }

    const buffer = Buffer.from(memo, 'base64')
    const hex = buffer.toString('hex')
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20),
    ].join('-')
  }

  private async fetchPaymentPage(
    server: Horizon.Server,
    accountId: string,
    cursor: null | string,
  ): Promise<Horizon.ServerApi.PaymentOperationRecord[]> {
    let request = server.payments().forAccount(accountId).order('asc').limit(STELLAR_PAGE_SIZE)
    if (cursor) {
      request = request.cursor(cursor)
    }

    const page = await request.call()
    return page.records as Horizon.ServerApi.PaymentOperationRecord[]
  }

  private async getStartPagingToken(prismaClient: PrismaClient): Promise<null | string> {
    const state = await prismaClient.stellarListenerState.findUnique({ where: { id: 'singleton' } })
    return state?.lastPagingToken ?? null
  }

  private async getStellarSecrets(): Promise<{ accountId: string, horizonUrl: string, usdcIssuer: string }> {
    const [accountId, horizonUrl, usdcIssuer] = await Promise.all([
      this.secretManager.getSecret(Secrets.STELLAR_ACCOUNT_ID),
      this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL),
      this.secretManager.getSecret(Secrets.STELLAR_USDC_ISSUER),
    ])

    return { accountId, horizonUrl, usdcIssuer }
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

  private async* iterateStellarPayments(
    server: Horizon.Server,
    accountId: string,
    startPagingToken: string,
  ): AsyncGenerator<Horizon.ServerApi.PaymentOperationRecord> {
    let cursor: null | string = startPagingToken

    while (true) {
      const records = await this.fetchPaymentPage(server, accountId, cursor)
      if (records.length === 0) {
        return
      }

      for (const payment of records) {
        yield payment
      }

      if (records.length < STELLAR_PAGE_SIZE) {
        return
      }

      cursor = records[records.length - 1]?.paging_token ?? cursor
    }
  }

  private async persistPagingToken(
    prismaClient: PrismaClient,
    startPagingToken: string,
    endPagingToken: null | string,
  ): Promise<void> {
    if (!endPagingToken || endPagingToken === startPagingToken) {
      return
    }

    const latestState = await prismaClient.stellarListenerState.findUnique({ where: { id: 'singleton' } })
    const currentToken = latestState?.lastPagingToken
    const shouldAdvanceCursor = !currentToken || BigInt(endPagingToken) > BigInt(currentToken)

    if (!shouldAdvanceCursor) {
      this.logger.warn('[PublicTransactionsController] Skipped cursor update because a newer cursor already exists', {
        existingCursor: currentToken,
        proposedCursor: endPagingToken,
      })
      return
    }

    await prismaClient.stellarListenerState.upsert({
      create: { id: 'singleton', lastPagingToken: endPagingToken },
      update: { lastPagingToken: endPagingToken },
      where: { id: 'singleton' },
    })
  }

  private async processPayment(
    payment: Horizon.ServerApi.PaymentOperationRecord,
    context: StellarReconciliationContext,
  ): Promise<PaymentProcessingOutcome> {
    const cursor = payment.paging_token

    if (!this.isUsdcPaymentToWallet(payment, context.accountId, context.usdcIssuer)) {
      return { cursor, result: 'irrelevant' }
    }

    let transactionId: null | string
    try {
      transactionId = await this.extractTransactionId(payment)
    }
    catch (error) {
      this.logger.error('[PublicTransactionsController] Failed to fetch/parse payment transaction', {
        error,
        paymentId: payment.id,
      })
      return { cursor, result: 'halt' }
    }

    if (!transactionId) {
      return { cursor, result: 'irrelevant' }
    }

    const transaction = await context.prismaClient.transaction.findUnique({
      select: { id: true, onChainId: true, status: true },
      where: { id: transactionId },
    })

    if (!transaction) {
      return { cursor, result: 'missing' }
    }

    if (transaction.status !== TransactionStatus.AWAITING_PAYMENT) {
      return { cursor, result: 'alreadyProcessed' }
    }

    const queueMessage: ReceivedCryptoTransactionMessage = {
      addressFrom: payment.from,
      amount: parseFloat(payment.amount),
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      onChainId: payment.id,
      transactionId: transaction.id,
    }

    try {
      await this.queueHandler.postMessage(QueueName.RECEIVED_CRYPTO_TRANSACTION, queueMessage)
      return { cursor, result: 'enqueued' }
    }
    catch (error: unknown) {
      this.logger.error('[PublicTransactionsController] Failed to enqueue recovered Stellar payment', {
        error,
        paymentId: payment.id,
        transactionId: transaction.id,
      })
      return { cursor, result: 'halt' }
    }
  }

  private async reconcileStellarPayments(context: StellarReconciliationContext): Promise<CheckUnprocessedStellarResponse> {
    const summary: CheckUnprocessedStellarResponse = {
      alreadyProcessed: 0,
      endPagingToken: context.startPagingToken,
      enqueued: 0,
      missingTransactions: 0,
      scannedPayments: 0,
      startPagingToken: context.startPagingToken,
    }

    for await (const payment of this.iterateStellarPayments(
      context.server,
      context.accountId,
      context.startPagingToken,
    )) {
      summary.scannedPayments += 1
      const outcome = await this.processPayment(payment, context)

      if (outcome.result === 'halt') {
        break
      }

      summary.endPagingToken = outcome.cursor
      this.applyOutcome(summary, outcome)
    }

    return summary
  }
}
