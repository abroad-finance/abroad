import { BlockchainNetwork, CryptoCurrency, OrphanRefundStatus } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { CryptoAssetConfigService } from '../../payments/application/CryptoAssetConfigService'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'
import { type RefundResult, RefundService } from './RefundService'
import { PaymentReconciliationReason } from './StellarTypes'

type RefundOutcome
  = | { outcome: 'already_refunded', refundTransactionId: null | string }
    | { outcome: 'failed', reason: string }
    | { outcome: 'in_flight', refundTransactionId: null | string }
    | { outcome: 'refunded', refundTransactionId: null | string }

@injectable()
export class StellarOrphanRefundService {
  private readonly logger: ScopedLogger
  private readonly refundService: RefundService

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly prismaProvider: IDatabaseClientProvider,
    @inject(TYPES.IWalletHandlerFactory) walletHandlerFactory: IWalletHandlerFactory,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'StellarOrphanRefundService' })
    this.refundService = new RefundService(walletHandlerFactory, baseLogger)
  }

  /**
   * Refunds a Stellar payment that cannot be reconciled because it lacks a memo.
   * Idempotent per payment id to avoid double refunds across reconciliation and streaming paths.
   */
  public async refundOrphanPayment(params: {
    payment: Horizon.ServerApi.PaymentOperationRecord
    reason: PaymentReconciliationReason
  }): Promise<RefundOutcome> {
    const amount = Number.parseFloat(params.payment.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      this.logger.error('Skipping orphan refund due to invalid amount', {
        amount: params.payment.amount,
        paymentId: params.payment.id,
        reason: params.reason,
      })
      return { outcome: 'failed', reason: 'invalid_amount' }
    }

    const prisma = await this.prismaProvider.getClient()
    const existing = await prisma.stellarOrphanRefund.findUnique({ where: { paymentId: params.payment.id } })
    if (existing?.status === OrphanRefundStatus.SUCCEEDED) {
      return { outcome: 'already_refunded', refundTransactionId: existing.refundTransactionId }
    }
    if (existing?.status === OrphanRefundStatus.PENDING) {
      return { outcome: 'in_flight', refundTransactionId: existing.refundTransactionId }
    }

    const cryptoCurrency = await this.resolveCryptoCurrency(params.payment)
    if (!cryptoCurrency) {
      await prisma.stellarOrphanRefund.upsert({
        create: {
          paymentId: params.payment.id,
          reason: params.reason,
          status: OrphanRefundStatus.FAILED,
          lastError: 'unsupported_asset',
        },
        update: {
          lastError: 'unsupported_asset',
          reason: params.reason,
          status: OrphanRefundStatus.FAILED,
        },
        where: { paymentId: params.payment.id },
      })
      this.logger.error('Skipping orphan refund due to unsupported asset', {
        assetCode: params.payment.asset_code,
        assetIssuer: params.payment.asset_issuer,
        paymentId: params.payment.id,
      })
      return { outcome: 'failed', reason: 'unsupported_asset' }
    }

    // Mark as pending to avoid parallel refunds before performing the on-chain operation.
    await prisma.stellarOrphanRefund.upsert({
      create: {
        paymentId: params.payment.id,
        reason: params.reason,
        status: OrphanRefundStatus.PENDING,
      },
      update: {
        lastError: null,
        reason: params.reason,
        status: OrphanRefundStatus.PENDING,
      },
      where: { paymentId: params.payment.id },
    })

    const transactionHash = await this.resolveTransactionHash(params.payment)
    if (!transactionHash) {
      const reason = 'missing_transaction_hash'
      await prisma.stellarOrphanRefund.update({
        data: {
          lastError: reason,
          status: OrphanRefundStatus.FAILED,
        },
        where: { paymentId: params.payment.id },
      })
      this.logger.error('Unable to resolve Stellar transaction hash for orphan refund', {
        paymentId: params.payment.id,
      })
      return { outcome: 'failed', reason }
    }

    let refundResult: RefundResult
    try {
      refundResult = await this.refundService.refundByOnChainId({
        amount,
        cryptoCurrency,
        network: BlockchainNetwork.STELLAR,
        onChainId: transactionHash,
      })
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'refund_exception'
      await prisma.stellarOrphanRefund.update({
        data: {
          lastError: reason,
          status: OrphanRefundStatus.FAILED,
        },
        where: { paymentId: params.payment.id },
      })
      this.logger.error('Exception while refunding orphan Stellar payment', {
        paymentId: params.payment.id,
        reason,
      })
      return { outcome: 'failed', reason }
    }

    return await this.persistOutcome(params.payment.id, refundResult, prisma)
  }

  private async persistOutcome(
    paymentId: string,
    refundResult: RefundResult,
    prisma: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
  ): Promise<RefundOutcome> {
    if (!refundResult.success) {
      const reason = refundResult.reason ?? 'unknown_refund_error'
      await prisma.stellarOrphanRefund.update({
        data: {
          lastError: reason,
          status: OrphanRefundStatus.FAILED,
        },
        where: { paymentId },
      })
      this.logger.error('Failed to refund orphan Stellar payment', { paymentId, reason })
      return { outcome: 'failed', reason }
    }

    await prisma.stellarOrphanRefund.update({
      data: {
        refundTransactionId: refundResult.transactionId ?? null,
        status: OrphanRefundStatus.SUCCEEDED,
      },
      where: { paymentId },
    })
    this.logger.info('Refunded orphan Stellar payment', {
      paymentId,
      refundTransactionId: refundResult.transactionId ?? null,
    })
    return { outcome: 'refunded', refundTransactionId: refundResult.transactionId ?? null }
  }

  private async resolveTransactionHash(
    payment: Horizon.ServerApi.PaymentOperationRecord,
  ): Promise<null | string> {
    if (payment.transaction_hash) {
      return payment.transaction_hash
    }
    try {
      const transaction = await payment.transaction()
      return transaction.id ?? null
    }
    catch (error) {
      this.logger.error('Failed to load Stellar transaction for orphan refund', {
        error,
        paymentId: payment.id,
      })
      return null
    }
  }

  private async resolveCryptoCurrency(
    payment: Horizon.ServerApi.PaymentOperationRecord,
  ): Promise<null | CryptoCurrency> {
    if (payment.asset_type !== 'credit_alphanum4' && payment.asset_type !== 'credit_alphanum12') {
      return null
    }

    if (!payment.asset_code || !payment.asset_issuer) {
      return null
    }

    const asset = await this.assetConfigService.resolveStellarAsset({
      assetCode: payment.asset_code,
      issuer: payment.asset_issuer,
    })
    return asset?.cryptoCurrency ?? null
  }
}
