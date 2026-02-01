import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'
import { RefundService } from '../../transactions/application/RefundService'
import { TransactionRepository } from '../../transactions/application/TransactionRepository'

@injectable()
export class RefundCoordinator {
  private readonly logger: ScopedLogger
  private readonly refundService: RefundService
  private readonly repository: TransactionRepository

  constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IWalletHandlerFactory) walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.refundService = new RefundService(walletHandlerFactory, baseLogger)
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowRefundCoordinator' })
  }

  public async refundByOnChainId(params: {
    amount: number
    cryptoCurrency: CryptoCurrency
    network: BlockchainNetwork
    onChainId: string
    reason: string
    transactionId: string
    trigger: string
  }): Promise<void> {
    const prismaClient = await this.repository.getClient()
    const idempotencyKey = `flow:refund:${params.transactionId}:${params.reason}`
    const reservation = await this.repository.reserveRefund(prismaClient, {
      idempotencyKey,
      reason: params.reason,
      transactionId: params.transactionId,
      trigger: params.trigger,
    })

    if (reservation.outcome !== 'reserved') {
      this.logger.info('Skipping refund; already handled', {
        outcome: reservation.outcome,
        transactionId: params.transactionId,
      })
      return
    }

    let refundResult
    try {
      refundResult = await this.refundService.refundByOnChainId({
        amount: params.amount,
        cryptoCurrency: params.cryptoCurrency,
        network: params.network,
        onChainId: params.onChainId,
      })
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_refund_error'
      refundResult = { reason, success: false }
    }

    try {
      await this.repository.recordRefundOutcome(prismaClient, {
        idempotencyKey,
        refundResult: refundResult.success
          ? { success: true, transactionId: refundResult.transactionId }
          : { reason: refundResult.reason, success: false, transactionId: refundResult.transactionId },
        transactionId: params.transactionId,
      })
    }
    catch (error) {
      this.logger.error('Failed to record refund outcome', error)
    }
  }

  public async refundToSender(params: {
    addressFrom: string
    amount: number
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
    reason: string
    transactionId: string
    trigger: string
  }): Promise<void> {
    const prismaClient = await this.repository.getClient()
    const idempotencyKey = `flow:refund:${params.transactionId}:${params.reason}`
    const reservation = await this.repository.reserveRefund(prismaClient, {
      idempotencyKey,
      reason: params.reason,
      transactionId: params.transactionId,
      trigger: params.trigger,
    })

    if (reservation.outcome !== 'reserved') {
      this.logger.info('Skipping refund; already handled', {
        outcome: reservation.outcome,
        transactionId: params.transactionId,
      })
      return
    }

    let refundResult
    try {
      refundResult = await this.refundService.refundToSender({
        addressFrom: params.addressFrom,
        amount: params.amount,
        blockchain: params.blockchain,
        cryptoCurrency: params.cryptoCurrency,
      })
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_refund_error'
      refundResult = { reason, success: false }
    }

    try {
      await this.repository.recordRefundOutcome(prismaClient, {
        idempotencyKey,
        refundResult: refundResult.success
          ? { success: true, transactionId: refundResult.transactionId }
          : { reason: refundResult.reason, success: false, transactionId: refundResult.transactionId },
        transactionId: params.transactionId,
      })
    }
    catch (error) {
      this.logger.error('Failed to record refund outcome', error)
    }
  }
}
