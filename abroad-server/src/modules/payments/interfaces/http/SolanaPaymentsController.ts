import { inject } from 'inversify'
import {
  Body,
  Controller,
  Post,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import z from 'zod'

import { BlockchainNetwork } from '@prisma/client'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { QueueName } from '../../../../platform/messaging/queues'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDepositVerifierRegistry } from '../../application/contracts/IDepositVerifier'

const solanaPaymentNotificationSchema = z.object({
  on_chain_tx: z.string().min(1, 'On-chain transaction signature is required'),
  transaction_id: z.string().uuid(),
})

interface SolanaPaymentNotificationRequest {
  on_chain_tx: string
  transaction_id: string
}

@Route('solana/payments')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class SolanaPaymentsController extends Controller {
  public constructor(
    @inject(TYPES.IDepositVerifierRegistry) private readonly verifierRegistry: IDepositVerifierRegistry,
    @inject(TYPES.IOutboxDispatcher) private readonly outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    super()
  }

  /**
   * Partners call this endpoint after sending a Solana payment so we can match it.
   * It verifies the on-chain transaction and enqueues the same workflow used by the Stellar listener.
   */
  @Post('notify')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('202', 'Payment enqueued')
  public async notifyPayment(
    @Body() requestBody: SolanaPaymentNotificationRequest,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
    @Res() notFoundResponse: TsoaResponse<404, { reason: string }>,
  ): Promise<{ enqueued: boolean }> {
    const parsed = solanaPaymentNotificationSchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }
    const { on_chain_tx: onChainSignature, transaction_id: transactionId } = parsed.data

    const verifier = this.verifierRegistry.getVerifier(BlockchainNetwork.SOLANA)
    const verification = await verifier.verifyNotification(onChainSignature, transactionId)
    if (verification.outcome === 'error') {
      if (verification.status === 404) {
        return notFoundResponse(404, { reason: verification.reason })
      }
      return badRequestResponse(400, { reason: verification.reason })
    }

    await this.outboxDispatcher.enqueueQueue(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      verification.queueMessage,
      'solana.notify',
      { deliverNow: true },
    )

    this.setStatus(202)
    return { enqueued: true }
  }
}
