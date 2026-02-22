import { inject } from 'inversify'
import {
  Body,
  Controller,
  OperationId,
  Post,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { OpsTransactionReconciliationService } from '../../application/OpsTransactionReconciliationService'
import { OpsReconcileHashRequest, opsReconcileHashRequestSchema, OpsReconcileHashResponse } from './opsContracts'

@Route('ops/transactions')
@Security('OpsApiKeyAuth')
export class OpsTransactionsController extends Controller {
  constructor(
    @inject(OpsTransactionReconciliationService)
    private readonly reconciliationService: OpsTransactionReconciliationService,
  ) {
    super()
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
}
