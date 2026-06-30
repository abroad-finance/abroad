import { TransactionStatus } from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Path,
  Post,
  Query,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { OpsTransactionDetailDto, OpsTransactionListResponse, OpsTransactionNotFoundError, OpsTransactionQueryService } from '../../application/OpsTransactionQueryService'
import { OpsTransactionReconciliationService } from '../../application/OpsTransactionReconciliationService'
import { OpsReconcileHashRequest, opsReconcileHashRequestSchema, OpsReconcileHashResponse } from './opsContracts'

@Route('ops/transactions')
@Security('OpsApiKeyAuth')
export class OpsTransactionsController extends Controller {
  constructor(
    @inject(OpsTransactionReconciliationService)
    private readonly reconciliationService: OpsTransactionReconciliationService,
    @inject(OpsTransactionQueryService)
    private readonly queryService: OpsTransactionQueryService,
  ) {
    super()
  }

  @Get('{transactionId}')
  @OperationId('OpsGetTransaction')
  @Response<404, { reason: string }>(404, 'Not Found')
  public async getById(
    @Path() transactionId: string,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsTransactionDetailDto> {
    try {
      return await this.queryService.getById(transactionId)
    }
    catch (error) {
      if (error instanceof OpsTransactionNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('OpsReconcileTransactionByHash')
  @Post('reconcile-hash')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Transaction hash reconciled')
  public async reconcileHash(
    @Body() requestBody: OpsReconcileHashRequest,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<OpsReconcileHashResponse> {
    const parsed = opsReconcileHashRequestSchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }

    const result = await this.reconciliationService.reconcileHash({
      blockchain: parsed.data.blockchain,
      onChainTx: parsed.data.on_chain_tx,
      transactionId: parsed.data.transaction_id,
    })

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
  @SuccessResponse('200', 'Transactions retrieved')
  public async search(
    @Query() status?: TransactionStatus,
    @Query() partnerId?: string,
    @Query() userId?: string,
    @Query() onChainId?: string,
    @Query() externalId?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<OpsTransactionListResponse> {
    return this.queryService.search({
      externalId,
      onChainId,
      page,
      pageSize,
      partnerId,
      status,
      userId,
    })
  }
}
