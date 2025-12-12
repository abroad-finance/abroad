// src/controllers/PublicTransactionsController.ts
import { inject } from 'inversify'
import { Controller, Post, Route, SuccessResponse } from 'tsoa'

import { ILogger, IQueueHandler } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../interfaces/ISecretManager'
import { IWebhookNotifier } from '../interfaces/IWebhookNotifier'
import { ExpiredTransactionService, type ExpiredTransactionsSummary } from '../services/publicTransactions/ExpiredTransactionService'
import { CheckUnprocessedStellarResponse, StellarReconciliationService } from '../services/publicTransactions/StellarReconciliationService'
import { TYPES } from '../types'

@Route('transactions')
export class PublicTransactionsController extends Controller {
  private readonly expiredTransactionService: ExpiredTransactionService
  private readonly stellarReconciliationService: StellarReconciliationService

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) logger: ILogger,
    @inject(TYPES.IWebhookNotifier) webhookNotifier: IWebhookNotifier,
    @inject(TYPES.IQueueHandler) queueHandler: IQueueHandler,
    @inject(TYPES.ISecretManager) secretManager: ISecretManager,
  ) {
    super()
    this.expiredTransactionService = new ExpiredTransactionService(
      prismaClientProvider,
      webhookNotifier,
      queueHandler,
      logger,
    )
    this.stellarReconciliationService = new StellarReconciliationService(
      prismaClientProvider,
      secretManager,
      queueHandler,
      logger,
    )
  }

  /**
   * Checks all awaiting-payment transactions and marks expired ones as failed.
   * Returns how many were inspected and updated.
   */
  @Post('check-expired')
  @SuccessResponse('200', 'Expired transactions processed')
  public async checkExpiredTransactions(): Promise<ExpiredTransactionsSummary> {
    return this.expiredTransactionService.process()
  }

  /**
   * Scans Stellar payments since the last stored cursor and enqueues any missed transactions.
   */
  @Post('check-unprocessed-stellar')
  @SuccessResponse('200', 'Unprocessed Stellar transactions checked')
  public async checkUnprocessedStellarTransactions(): Promise<CheckUnprocessedStellarResponse> {
    return this.stellarReconciliationService.reconcile()
  }
}
