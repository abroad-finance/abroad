import { BlockchainNetwork } from '@prisma/client'
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
import z from 'zod'

import { TYPES } from '../../../../app/container/types'
import { QueueName } from '../../../../platform/messaging/queues'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDepositVerifierRegistry } from '../../application/contracts/IDepositVerifier'

const notifySchema = z.object({
  blockchain: z.nativeEnum(BlockchainNetwork),
  on_chain_tx: z.string().min(1, 'On-chain transaction hash is required'),
  transaction_id: z.string().uuid(),
})

interface NotifyPaymentRequest {
  blockchain: BlockchainNetwork
  on_chain_tx: string
  transaction_id: string
}

@Route('payments')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class PaymentsNotifyController extends Controller {
  constructor(
    @inject(TYPES.IDepositVerifierRegistry) private readonly verifierRegistry: IDepositVerifierRegistry,
    @inject(TYPES.IOutboxDispatcher) private readonly outboxDispatcher: OutboxDispatcher,
  ) {
    super()
  }

  /**
   * Generic notify endpoint for non-Stellar chains.
   */
  @OperationId('PaymentsNotify')
  @Post('notify')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('202', 'Payment enqueued')
  public async notify(
    @Body() requestBody: NotifyPaymentRequest,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
    @Res() notFoundResponse: TsoaResponse<404, { reason: string }>,
  ): Promise<{ enqueued: boolean }> {
    const parsed = notifySchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }

    const { blockchain, on_chain_tx: onChainTx, transaction_id: transactionId } = parsed.data

    if (blockchain === BlockchainNetwork.STELLAR) {
      return badRequestResponse(400, { reason: 'Stellar payments are detected automatically' })
    }

    const verifier = this.verifierRegistry.getVerifier(blockchain)
    const verification = await verifier.verifyNotification(onChainTx, transactionId)
    if (verification.outcome === 'error') {
      if (verification.status === 404) {
        return notFoundResponse(404, { reason: verification.reason })
      }
      return badRequestResponse(400, { reason: verification.reason })
    }

    await this.outboxDispatcher.enqueueQueue(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      verification.queueMessage,
      'payments.notify',
      { deliverNow: true },
    )

    this.setStatus(202)
    return { enqueued: true }
  }
}
