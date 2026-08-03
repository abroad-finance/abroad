import type { Request as RequestExpress } from 'express'

import {
  BlockchainNetwork,
  CryptoCurrency,
  OpsWorkStatus,
  OutboxStatus,
  PaymentMethod,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Path,
  Post,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { requireNamedOpsPrincipal, requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { OpsAuditService } from '../../../operations/application/OpsAuditService'
import { OpsMutationService } from '../../../operations/application/opsMutation'
import { readOpsMutationEnvelope } from '../../../operations/interfaces/http/opsMutationHeaders'
import { OpsRefundRecoveryDto, OpsRefundRecoveryService } from '../../application/OpsRefundRecoveryService'
import {
  OpsAttentionFilter,
  OpsProofSummaryDto,
  OpsRefundSummaryDto,
  OpsTransactionDetailDto,
  OpsTransactionEvidenceExportDto,
  OpsTransactionFilteredEvidenceExportDto,
  OpsTransactionListResponse,
  OpsTransactionNotFoundError,
  OpsTransactionQueryService,
  OpsTransactionQueryValidationError,
} from '../../application/OpsTransactionQueryService'
import { OpsTransactionReconciliationService } from '../../application/OpsTransactionReconciliationService'
import {
  PartnerPixReceiptDto,
  PartnerPixReceiptLanguage,
  PartnerPixReceiptNotFoundError,
  PartnerPixReceiptProviderError,
  PartnerPixReceiptService,
  PartnerPixReceiptUnavailableError,
} from '../../application/PartnerPixReceiptService'
import { OpsReconcileHashRequest, opsReconcileHashRequestSchema, OpsReconcileHashResponse, OpsRefundRecoveryResponse } from './opsContracts'

/* eslint-disable perfectionist/sort-classes -- Tsoa preserves controller declaration order; static routes must precede the transaction-id route. */

const receiptLanguages: readonly PartnerPixReceiptLanguage[] = ['en', 'pt-BR']

@Route('ops/transactions')
export class OpsTransactionsController extends Controller {
  public constructor(
    @inject(OpsTransactionReconciliationService)
    private readonly reconciliationService: OpsTransactionReconciliationService,
    @inject(OpsTransactionQueryService)
    private readonly queryService: OpsTransactionQueryService,
    @inject(OpsRefundRecoveryService)
    private readonly refundRecoveryService: OpsRefundRecoveryService,
    @inject(OpsMutationService)
    private readonly mutationService: OpsMutationService,
    @inject(PartnerPixReceiptService)
    private readonly receiptService: PartnerPixReceiptService,
    @inject(OpsAuditService)
    private readonly auditService: OpsAuditService,
  ) {
    super()
  }

  @Get('{transactionId}/refund-recovery')
  @OperationId('OpsGetRefundRecovery')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['transactions:read'])
  public async getRefundRecovery(
    @Path() transactionId: string,
  ): Promise<OpsRefundRecoveryResponse> {
    this.setHeader('Cache-Control', 'private, no-store')
    return this.toRefundRecoveryResponse(await this.refundRecoveryService.getStatus(transactionId))
  }

  @OperationId('OpsReconcileRefundRecovery')
  @Post('{transactionId}/refund-recovery/reconcile')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['transactions:refund'])
  @SuccessResponse('200', 'Refund reconciled')
  public async reconcileRefundRecovery(
    @Path() transactionId: string,
    @Request() request: RequestExpress,
  ): Promise<OpsRefundRecoveryResponse> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    const result = await this.mutationService.execute(
      principal,
      'transaction.refund.reconcile',
      { id: transactionId, type: 'transaction_refund' },
      envelope,
      () => this.refundRecoveryService.reconcile({
        expectedVersion: envelope.expectedVersion ?? 0,
        transactionId,
      }),
      value => ({
        metadata: {
          canonicalRefundRecorded: value.canonicalRefundRecorded,
          recoveryStatus: value.status,
          replacementEligible: value.replacementEligible,
        },
        resourceId: value.transactionId,
      }),
    )
    return this.toRefundRecoveryResponse(result)
  }

  @OperationId('OpsIssueReplacementRefund')
  @Post('{transactionId}/refund-recovery/replace')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['transactions:refund'])
  @SuccessResponse('200', 'Replacement refund submitted')
  public async issueReplacementRefund(
    @Path() transactionId: string,
    @Request() request: RequestExpress,
  ): Promise<OpsRefundRecoveryResponse> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    const result = await this.mutationService.execute(
      principal,
      'transaction.refund.replace',
      { id: transactionId, type: 'transaction_refund' },
      envelope,
      () => this.refundRecoveryService.issueReplacement({
        expectedVersion: envelope.expectedVersion ?? 0,
        initiatedByOpsUserId: principal.userId,
        mutationIdempotencyKey: envelope.idempotencyKey,
        transactionId,
      }),
      value => ({
        metadata: {
          canonicalRefundRecorded: value.canonicalRefundRecorded,
          recoveryStatus: value.status,
        },
        resourceId: value.transactionId,
      }),
    )
    return this.toRefundRecoveryResponse(result)
  }

  @Get('{transactionId}/evidence')
  @OperationId('OpsExportTransactionEvidence')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['transactions:export'])
  public async exportEvidence(
    @Path() transactionId: string,
    @Request() request: RequestExpress,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsTransactionEvidenceExportDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    try {
      const evidence = await this.queryService.getEvidenceExport(transactionId)
      await this.auditService.record(principal, {
        action: 'transaction.evidence.exported',
        metadata: { eventCount: evidence.evidence.length },
        resourceId: transactionId,
        resourceType: 'transaction',
      })
      this.setHeader('Cache-Control', 'private, no-store')
      this.setHeader('Content-Disposition', `attachment; filename="abroad-ops-evidence-${transactionId}.json"`)
      return evidence
    }
    catch (error) {
      if (error instanceof OpsTransactionNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Get('export')
  @OperationId('OpsExportFilteredTransactionEvidence')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['transactions:export'])
  public async exportFilteredEvidence(
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Query() query?: string,
    @Query() status?: TransactionStatus,
    @Query() partnerId?: string,
    @Query() createdFrom?: string,
    @Query() createdTo?: string,
    @Query() paymentMethod?: PaymentMethod,
    @Query() cryptoCurrency?: CryptoCurrency,
    @Query() network?: BlockchainNetwork,
    @Query() targetCurrency?: TargetCurrency,
    @Query() proofStatus?: OpsProofSummaryDto['status'],
    @Query() refundStatus?: OpsRefundSummaryDto['status'],
    @Query() webhookStatus?: OutboxStatus,
    @Query() caseStatus?: OpsWorkStatus,
    @Query() caseOwnerId?: string,
    @Query() attention?: OpsAttentionFilter,
  ): Promise<OpsTransactionFilteredEvidenceExportDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    try {
      const evidence = await this.queryService.getFilteredEvidenceExport({
        attention,
        caseOwnerId,
        caseStatus,
        createdFrom,
        createdTo,
        cryptoCurrency,
        network,
        partnerId,
        paymentMethod,
        proofStatus,
        query,
        refundStatus,
        status,
        targetCurrency,
        webhookStatus,
      })
      await this.auditService.record(principal, {
        action: 'transaction.filtered_evidence.exported',
        metadata: {
          exportedCount: evidence.items.length,
          filterDimensions: evidence.filterDimensions,
          total: evidence.total,
          truncated: evidence.truncated,
        },
        resourceType: 'transaction_collection',
      })
      this.setHeader('Cache-Control', 'private, no-store')
      this.setHeader('Content-Disposition', 'attachment; filename="abroad-ops-transaction-evidence.json"')
      return evidence
    }
    catch (error) {
      if (error instanceof OpsTransactionQueryValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Get('reconciliation-queue')
  @OperationId('OpsListTransactionReconciliationQueue')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['transactions:read'])
  public async reconciliationQueue(
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Query() attention: OpsAttentionFilter = 'ALL',
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<OpsTransactionListResponse> {
    try {
      return await this.queryService.search({ attention, page, pageSize })
    }
    catch (error) {
      if (error instanceof OpsTransactionQueryValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Get('{transactionId}')
  @OperationId('OpsGetTransaction')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['transactions:read'])
  public async getById(
    @Path() transactionId: string,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsTransactionDetailDto> {
    try {
      this.setHeader('Cache-Control', 'private, no-store')
      return await this.queryService.getById(transactionId)
    }
    catch (error) {
      if (error instanceof OpsTransactionNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Get('{transactionId}/receipt')
  @OperationId('OpsGetTransactionPixReceipt')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Response<502, { reason: string }>(502, 'Bad Gateway')
  @Security('OpsAuth', ['transactions:proof'])
  public async getReceipt(
    @Path() transactionId: string,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
    @Res() unavailable: TsoaResponse<409, { reason: string }>,
    @Res() badGateway: TsoaResponse<502, { reason: string }>,
    @Query() lang: PartnerPixReceiptLanguage = 'pt-BR',
  ): Promise<PartnerPixReceiptDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    if (!receiptLanguages.includes(lang)) {
      return badRequest(400, { reason: 'Receipt language must be pt-BR or en' })
    }
    try {
      const receipt = await this.receiptService.getOpsReceipt(transactionId, lang)
      await this.auditService.record(principal, {
        action: 'transaction.receipt.retrieved',
        metadata: { language: lang, sizeBytes: receipt.sizeBytes },
        resourceId: transactionId,
        resourceType: 'transaction',
      })
      this.setHeader('Cache-Control', 'private, no-store')
      return receipt
    }
    catch (error) {
      const failureCode = error instanceof PartnerPixReceiptNotFoundError
        ? 'not_found'
        : error instanceof PartnerPixReceiptUnavailableError
          ? 'unavailable'
          : 'provider_error'
      await this.auditService.record(principal, {
        action: 'transaction.receipt.request_failed',
        metadata: { failureCode, language: lang },
        resourceId: transactionId,
        resourceType: 'transaction',
      })
      if (error instanceof PartnerPixReceiptNotFoundError) return notFound(404, { reason: error.message })
      if (error instanceof PartnerPixReceiptUnavailableError) return unavailable(409, { reason: error.message })
      if (error instanceof PartnerPixReceiptProviderError) return badGateway(502, { reason: error.message })
      throw error
    }
  }

  @OperationId('OpsReconcileTransactionByHash')
  @Post('reconcile-hash')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['transactions:reconcile'])
  @SuccessResponse('200', 'Transaction hash reconciled')
  public async reconcileHash(
    @Body() requestBody: OpsReconcileHashRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<OpsReconcileHashResponse> {
    const parsed = opsReconcileHashRequestSchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }
    const result = await this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'transaction.reconcile_hash',
      { id: parsed.data.transaction_id, type: 'transaction' },
      readOpsMutationEnvelope(request),
      () => this.reconciliationService.reconcileHash({
        blockchain: parsed.data.blockchain,
        onChainTx: parsed.data.on_chain_tx,
        transactionId: parsed.data.transaction_id,
      }),
      value => ({ resourceId: value.transactionId ?? undefined }),
    )
    return {
      blockchain: result.blockchain,
      on_chain_tx: result.onChainTx,
      reason: result.reason,
      result: result.result,
      transaction_id: result.transactionId,
      transaction_status: result.transactionStatus,
    }
  }

  @Get()
  @OperationId('OpsSearchTransactions')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['transactions:read'])
  @SuccessResponse('200', 'Transactions retrieved')
  public async search(
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Query() query?: string,
    @Query() status?: TransactionStatus,
    @Query() partnerId?: string,
    @Query() createdFrom?: string,
    @Query() createdTo?: string,
    @Query() paymentMethod?: PaymentMethod,
    @Query() cryptoCurrency?: CryptoCurrency,
    @Query() network?: BlockchainNetwork,
    @Query() targetCurrency?: TargetCurrency,
    @Query() proofStatus?: OpsProofSummaryDto['status'],
    @Query() refundStatus?: OpsRefundSummaryDto['status'],
    @Query() webhookStatus?: OutboxStatus,
    @Query() caseStatus?: OpsWorkStatus,
    @Query() caseOwnerId?: string,
    @Query() attention?: OpsAttentionFilter,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<OpsTransactionListResponse> {
    try {
      return await this.queryService.search({
        attention,
        caseOwnerId,
        caseStatus,
        createdFrom,
        createdTo,
        cryptoCurrency,
        network,
        page,
        pageSize,
        partnerId,
        paymentMethod,
        proofStatus,
        query,
        refundStatus,
        status,
        targetCurrency,
        webhookStatus,
      })
    }
    catch (error) {
      if (error instanceof OpsTransactionQueryValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  private toRefundRecoveryResponse(value: OpsRefundRecoveryDto): OpsRefundRecoveryResponse {
    return {
      amount: value.amount,
      asset: value.asset,
      attempts: value.attempts,
      block_reason: value.blockReason,
      candidate_hash_fingerprint: value.candidateHashFingerprint,
      canonical_refund_recorded: value.canonicalRefundRecorded,
      last_failure_category: value.lastFailureCategory,
      last_reconciliation: value.lastReconciliation,
      network: value.network,
      replacement_eligible: value.replacementEligible,
      status: value.status,
      transaction_id: value.transactionId,
      version: value.version,
    }
  }
}
