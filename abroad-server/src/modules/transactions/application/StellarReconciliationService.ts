import { BlockchainNetwork, PrismaClient, TransactionStatus } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'

import { ILogger } from '../../../core/logging/types'
import { QueueName } from '../../../platform/messaging/queues'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'
import { IDepositVerifierRegistry } from '../../payments/application/contracts/IDepositVerifier'

export type CheckUnprocessedStellarResponse = {
  alreadyProcessed: number
  endPagingToken: null | string
  enqueued: number
  missingTransactions: number
  scannedPayments: number
  startPagingToken: null | string
}

export type SingleStellarReconciliationResponse = {
  paymentId: string
  reason?: PaymentReconciliationReason
  result: 'alreadyProcessed' | 'enqueued' | 'failed' | 'invalid' | 'irrelevant' | 'missing' | 'notFound'
  transactionId: null | string
}

type PaymentLookupResult
  = | { payment: Horizon.ServerApi.PaymentOperationRecord, status: 'found' }
    | { status: 'failed' }
    | { status: 'invalid' }
    | { status: 'notFound' }
    | { status: 'unsupported' }

type PaymentProcessingOutcome
  = | { cursor: string, reason?: PaymentReconciliationReason, result: 'alreadyProcessed' | 'enqueued' | 'missing', transactionId: string }
    | { cursor: string, reason?: PaymentReconciliationReason, result: 'invalid' | 'irrelevant' }
    | { cursor: string, result: 'halt', transactionId?: string }

type PaymentReconciliationReason
  = | 'assetOrDestinationMismatch'
    | 'invalidMemoFormat'
    | 'missingMemo'

type StellarPaymentContext = {
  accountId: string
  prismaClient: PrismaClient
  usdcIssuer: string
}

type StellarReconciliationContext = StellarPaymentContext & {
  scanStartPagingToken: string
  server: Horizon.Server
  storedPagingToken: string
}

const STELLAR_PAGE_SIZE = 200

export class StellarReconciliationService {
  constructor(
    private readonly prismaProvider: IDatabaseClientProvider,
    private readonly secretManager: ISecretManager,
    private readonly outboxDispatcher: OutboxDispatcher,
    private readonly verifierRegistry: IDepositVerifierRegistry,
    private readonly logger: ILogger,
  ) {}

  public async reconcile(): Promise<CheckUnprocessedStellarResponse> {
    const prismaClient = await this.prismaProvider.getClient()
    const storedPagingToken = await this.getStartPagingToken(prismaClient)

    if (!storedPagingToken) {
      this.logger.warn('[PublicTransactionsController] No Stellar listener cursor found; skipping reconciliation run')
      return this.buildEmptySummary()
    }

    const { accountId, horizonUrl, usdcIssuer } = await this.getStellarSecrets()
    const server = new Horizon.Server(horizonUrl)
    const scanStartPagingToken = await this.rewindPagingToken(
      server,
      accountId,
      storedPagingToken,
      this.getLookbackPages(),
    )

    const summary = await this.reconcileStellarPayments({
      accountId,
      prismaClient,
      scanStartPagingToken,
      server,
      storedPagingToken,
      usdcIssuer,
    })

    await this.persistPagingToken(prismaClient, storedPagingToken, summary.endPagingToken)

    return summary
  }

  public async reconcilePaymentById(paymentId: string): Promise<SingleStellarReconciliationResponse> {
    const normalizedPaymentId = paymentId.trim()
    if (!normalizedPaymentId) {
      this.logger.warn('[PublicTransactionsController] Empty Stellar payment id provided for reconciliation', {
        paymentId,
      })
      return { paymentId, result: 'invalid', transactionId: null }
    }

    const prismaClient = await this.prismaProvider.getClient()
    const { accountId, horizonUrl, usdcIssuer } = await this.getStellarSecrets()
    const server = new Horizon.Server(horizonUrl)

    const lookupResult = await this.fetchPaymentById(server, normalizedPaymentId)
    if (lookupResult.status === 'failed') {
      return { paymentId: normalizedPaymentId, result: 'failed', transactionId: null }
    }
    if (lookupResult.status === 'invalid') {
      return { paymentId: normalizedPaymentId, result: 'invalid', transactionId: null }
    }
    if (lookupResult.status === 'notFound') {
      return { paymentId: normalizedPaymentId, result: 'notFound', transactionId: null }
    }
    if (lookupResult.status === 'unsupported') {
      return { paymentId: normalizedPaymentId, result: 'irrelevant', transactionId: null }
    }

    const outcome = await this.processPayment(lookupResult.payment, { accountId, prismaClient, usdcIssuer })
    if (outcome.result === 'halt') {
      return { paymentId: normalizedPaymentId, result: 'failed', transactionId: outcome.transactionId ?? null }
    }

    const transactionId = 'transactionId' in outcome ? outcome.transactionId : null
    const reason = 'reason' in outcome ? outcome.reason : undefined
    return {
      paymentId: normalizedPaymentId,
      reason,
      result: outcome.result,
      transactionId,
    }
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
      case 'invalid':
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

  private extractErrorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined
    }

    if ('response' in error) {
      const response = (error as { response?: { status?: number } }).response
      if (response && typeof response.status === 'number') {
        return response.status
      }
    }

    if ('status' in error) {
      const status = (error as { status?: number }).status
      if (typeof status === 'number') {
        return status
      }
    }

    return undefined
  }

  private async extractTransactionId(
    payment: Horizon.ServerApi.PaymentOperationRecord,
  ): Promise<{ reason: PaymentReconciliationReason, transactionId: null } | { reason?: undefined, transactionId: string }> {
    const transaction = await payment.transaction()
    const memo = transaction.memo?.trim()

    if (!memo) {
      return { reason: 'missingMemo', transactionId: null }
    }

    const buffer = Buffer.from(memo, 'base64')
    if (buffer.length < 16) {
      return { reason: 'invalidMemoFormat', transactionId: null }
    }

    const hex = buffer.toString('hex')
    const transactionId = [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20),
    ].join('-')

    return { transactionId }
  }

  private async fetchPaymentById(server: Horizon.Server, paymentId: string): Promise<PaymentLookupResult> {
    try {
      const operation = await server.operations().operation(paymentId).call()
      if (!this.isPaymentOperationRecord(operation)) {
        this.logger.warn('[PublicTransactionsController] Stellar operation is not a direct payment', {
          operationType: operation.type,
          paymentId,
        })
        return { status: 'unsupported' }
      }

      return { payment: operation, status: 'found' }
    }
    catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return { status: 'notFound' }
      }
      if (this.isBadRequestError(error)) {
        this.logger.warn('[PublicTransactionsController] Invalid Stellar payment id supplied', {
          paymentId,
        })
        return { status: 'invalid' }
      }

      this.logger.error('[PublicTransactionsController] Failed to load Stellar payment for reconciliation', {
        error,
        paymentId,
      })
      return { status: 'failed' }
    }
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

  private getLookbackPages(): number {
    const envValue = process.env.STELLAR_RECONCILIATION_LOOKBACK_PAGES
    if (!envValue) {
      return 1
    }

    const parsed = Number.parseInt(envValue, 10)
    if (Number.isNaN(parsed) || parsed < 0) {
      this.logger.warn('[PublicTransactionsController] Invalid STELLAR_RECONCILIATION_LOOKBACK_PAGES value; defaulting to 1', {
        envValue,
      })
      return 1
    }

    return parsed
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

  private isBadRequestError(error: unknown): boolean {
    return this.extractErrorStatus(error) === 400
  }

  private isNotFoundError(error: unknown): boolean {
    return this.extractErrorStatus(error) === 404
  }

  private isPaymentOperationRecord(
    record: Horizon.ServerApi.OperationRecord,
  ): record is Horizon.ServerApi.PaymentOperationRecord {
    return record.type === 'payment'
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
    context: StellarPaymentContext,
  ): Promise<PaymentProcessingOutcome> {
    const cursor = payment.paging_token

    if (!this.isUsdcPaymentToWallet(payment, context.accountId, context.usdcIssuer)) {
      return { cursor, reason: 'assetOrDestinationMismatch', result: 'irrelevant' }
    }

    let transactionIdResult: Awaited<ReturnType<typeof this.extractTransactionId>>
    try {
      transactionIdResult = await this.extractTransactionId(payment)
    }
    catch (error) {
      this.logger.error('[PublicTransactionsController] Failed to fetch/parse payment transaction', {
        error,
        paymentId: payment.id,
      })
      return { cursor, result: 'halt' }
    }

    if (!transactionIdResult.transactionId) {
      this.logger.warn('[PublicTransactionsController] Stellar payment missing usable memo; skipping reconciliation', {
        paymentId: payment.id,
        reason: transactionIdResult.reason,
      })
      return { cursor, reason: transactionIdResult.reason, result: 'invalid' }
    }
    const transactionId = transactionIdResult.transactionId

    const transaction = await context.prismaClient.transaction.findUnique({
      select: { id: true, refundOnChainId: true, status: true },
      where: { id: transactionId },
    })

    if (!transaction) {
      return { cursor, result: 'missing', transactionId }
    }

    const isAwaitingPayment = transaction.status === TransactionStatus.AWAITING_PAYMENT
    const isExpiredPayment = transaction.status === TransactionStatus.PAYMENT_EXPIRED

    if (!isAwaitingPayment && !isExpiredPayment) {
      return { cursor, result: 'alreadyProcessed', transactionId: transaction.id }
    }

    if (isExpiredPayment && transaction.refundOnChainId) {
      this.logger.info('[PublicTransactionsController] Skipping expired Stellar payment because refund already exists', {
        refundOnChainId: transaction.refundOnChainId,
        transactionId: transaction.id,
      })
      return { cursor, result: 'alreadyProcessed', transactionId: transaction.id }
    }

    try {
      const verifier = this.verifierRegistry.getVerifier(BlockchainNetwork.STELLAR)
      const verification = await verifier.verifyNotification(payment.id, transaction.id)
      if (verification.outcome === 'error') {
        this.logger.warn('[PublicTransactionsController] Verification failed for Stellar payment', {
          paymentId: payment.id,
          reason: verification.reason,
          status: verification.status,
          transactionId: transaction.id,
        })
        return { cursor, result: 'halt', transactionId: transaction.id }
      }

      await this.outboxDispatcher.enqueueQueue(
        QueueName.RECEIVED_CRYPTO_TRANSACTION,
        verification.queueMessage,
        'stellar.reconcile',
        { deliverNow: true },
      )
      return { cursor, result: 'enqueued', transactionId: transaction.id }
    }
    catch (error: unknown) {
      this.logger.error('[PublicTransactionsController] Failed to enqueue recovered Stellar payment', {
        error,
        paymentId: payment.id,
        transactionId: transaction.id,
      })
      return { cursor, result: 'halt', transactionId: transaction.id }
    }
  }

  private async reconcileStellarPayments(context: StellarReconciliationContext): Promise<CheckUnprocessedStellarResponse> {
    const summary: CheckUnprocessedStellarResponse = {
      alreadyProcessed: 0,
      endPagingToken: context.storedPagingToken,
      enqueued: 0,
      missingTransactions: 0,
      scannedPayments: 0,
      startPagingToken: context.storedPagingToken,
    }

    for await (const payment of this.iterateStellarPayments(
      context.server,
      context.accountId,
      context.scanStartPagingToken,
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

  private async rewindPagingToken(
    server: Horizon.Server,
    accountId: string,
    currentPagingToken: string,
    lookbackPages: number,
  ): Promise<string> {
    if (lookbackPages <= 0) {
      return currentPagingToken
    }

    let cursor: null | string = currentPagingToken
    let earliestSeenToken = currentPagingToken

    for (let pageIndex = 0; pageIndex < lookbackPages; pageIndex += 1) {
      const page = await server
        .payments()
        .forAccount(accountId)
        .order('desc')
        .cursor(cursor)
        .limit(STELLAR_PAGE_SIZE)
        .call()

      const records = page.records as Horizon.ServerApi.PaymentOperationRecord[]
      if (records.length === 0) {
        break
      }

      const oldestRecordOnPage = records[records.length - 1]
      earliestSeenToken = oldestRecordOnPage?.paging_token ?? earliestSeenToken

      const hasReachedOldestSeen = oldestRecordOnPage?.paging_token === cursor
      if (records.length < STELLAR_PAGE_SIZE || hasReachedOldestSeen) {
        break
      }

      cursor = oldestRecordOnPage?.paging_token ?? null
    }

    if (earliestSeenToken !== currentPagingToken) {
      this.logger.info('[PublicTransactionsController] Rewound Stellar reconciliation cursor', {
        currentPagingToken,
        effectivePagingToken: earliestSeenToken,
        lookbackPages,
        pageSize: STELLAR_PAGE_SIZE,
      })
    }

    return earliestSeenToken
  }
}
