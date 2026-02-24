// src/modules/transactions/interfaces/http/PublicTransactionsController.ts
import { inject } from 'inversify'
import { Controller, Post, Route, SuccessResponse } from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IDepositVerifierRegistry } from '../../../payments/application/contracts/IDepositVerifier'
import { CryptoAssetConfigService } from '../../../payments/application/CryptoAssetConfigService'
import { ExpiredTransactionService, type ExpiredTransactionsSummary } from '../../application/ExpiredTransactionService'
import { StellarOrphanRefundService } from '../../application/StellarOrphanRefundService'
import { CheckUnprocessedStellarResponse, StellarReconciliationService } from '../../application/StellarReconciliationService'

@Route('transactions')
export class PublicTransactionsController extends Controller {
  private readonly expiredTransactionService: ExpiredTransactionService
  private readonly stellarReconciliationService: StellarReconciliationService

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.IDepositVerifierRegistry) depositVerifierRegistry: IDepositVerifierRegistry,
    @inject(TYPES.StellarOrphanRefundService) orphanRefundService: StellarOrphanRefundService,
    @inject(CryptoAssetConfigService) assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ISecretManager) secretManager: ISecretManager,
  ) {
    super()
    this.expiredTransactionService = new ExpiredTransactionService(
      prismaClientProvider,
      outboxDispatcher,
      this.logger,
    )
    this.stellarReconciliationService = new StellarReconciliationService(
      prismaClientProvider,
      secretManager,
      outboxDispatcher,
      orphanRefundService,
      assetConfigService,
      depositVerifierRegistry,
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
}
