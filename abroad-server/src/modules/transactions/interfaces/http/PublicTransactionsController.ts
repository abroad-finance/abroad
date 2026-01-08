// src/modules/transactions/interfaces/http/PublicTransactionsController.ts
import { timingSafeEqual } from 'crypto'
import { inject } from 'inversify'
import {
  Controller,
  Header,
  Hidden,
  Path,
  Post,
  Response,
  Route,
  SuccessResponse,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { ExpiredTransactionService, type ExpiredTransactionsSummary } from '../../application/ExpiredTransactionService'
import { CheckUnprocessedStellarResponse, SingleStellarReconciliationResponse, StellarReconciliationService } from '../../application/StellarReconciliationService'

const STELLAR_RECONCILIATION_HEADER = 'X-Abroad-Stellar-Reconciliation-Secret'

@Route('transactions')
export class PublicTransactionsController extends Controller {
  private readonly expiredTransactionService: ExpiredTransactionService
  private reconciliationSecret: string | undefined
  private readonly stellarReconciliationService: StellarReconciliationService

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
  ) {
    super()
    this.expiredTransactionService = new ExpiredTransactionService(
      prismaClientProvider,
      outboxDispatcher,
      this.logger,
    )
    this.stellarReconciliationService = new StellarReconciliationService(
      prismaClientProvider,
      this.secretManager,
      queueHandler,
      this.logger,
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

  /**
   * Reconciles a single Stellar payment by its payment operation id.
   */
  @Hidden()
  @Post('reconcile-stellar/{paymentId}')
  @Response('401', 'Unauthorized')
  @SuccessResponse('200', 'Stellar payment reconciled')
  public async reconcileStellarPayment(
    @Path() paymentId: string,
    @Header(STELLAR_RECONCILIATION_HEADER) reconciliationSecret?: string,
  ): Promise<SingleStellarReconciliationResponse> {
    await this.assertReconciliationSecret(reconciliationSecret)
    return this.stellarReconciliationService.reconcilePaymentById(paymentId)
  }

  private async assertReconciliationSecret(reconciliationSecret?: string): Promise<void> {
    const provided = reconciliationSecret?.trim()
    if (!provided) {
      this.logger.warn('[PublicTransactionsController] Missing Stellar reconciliation secret header')
      this.setStatus(401)
      throw new Error('Unauthorized')
    }

    let expected: string
    try {
      expected = await this.getReconciliationSecret()
    }
    catch (error: unknown) {
      this.logger.error('[PublicTransactionsController] Failed to load Stellar reconciliation secret', error)
      this.setStatus(401)
      throw new Error('Unauthorized')
    }

    if (!expected) {
      this.logger.error('[PublicTransactionsController] Stellar reconciliation secret is not configured')
      this.setStatus(401)
      throw new Error('Unauthorized')
    }

    if (!this.secretsMatch(provided, expected)) {
      this.logger.warn('[PublicTransactionsController] Invalid Stellar reconciliation secret header')
      this.setStatus(401)
      throw new Error('Unauthorized')
    }
  }

  private async getReconciliationSecret(): Promise<string> {
    if (this.reconciliationSecret === undefined) {
      this.reconciliationSecret = await this.secretManager.getSecret(Secrets.STELLAR_RECONCILIATION_SECRET)
    }
    return this.reconciliationSecret
  }

  private secretsMatch(provided: string, expected: string): boolean {
    if (provided.length !== expected.length) {
      return false
    }
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  }
}
