import { PaymentMethod, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { createHash } from 'node:crypto'
import { ZodError } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { TransferoUltraClient, TransferoUltraError } from '../../../transfero/infrastructure/TransferoUltraClient'
import { transferoUltraDepositDetailResponseSchema, transferoUltraDynamicQrResponseSchema, transferoUltraRefundResponseSchema } from '../../../transfero/infrastructure/transferoUltraSchemas'
import {
  FiatDepositCapability,
  FiatDepositCreateResult,
  FiatDepositFactsResult,
  FiatDepositFailureCode,
  FiatDepositRefundResult,
  FiatDepositStatus,
  IFiatDepositService,
} from '../../application/contracts/IFiatDepositService'

/**
 * Ultra requires a dynamic QR's txid to be 26–35 characters. Our transaction id
 * is a 36-character UUID, so the hyphens are stripped to land on exactly 32.
 */
const MIN_ULTRA_DYNAMIC_TXID_LENGTH = 26
const MAX_ULTRA_DYNAMIC_TXID_LENGTH = 35

const DEPOSIT_STATUS_BY_ULTRA_STATUS: Readonly<Record<string, FiatDepositStatus>> = {
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
  PAID: 'PAID',
  PENDING: 'AWAITING_PAYMENT',
  PROCESSING: 'PAID',
  REFUNDED: 'REFUNDED',
}

@injectable()
export class TransferoPixDepositService implements IFiatDepositService {
  public readonly capability: FiatDepositCapability = {
    method: PaymentMethod.PIX,
    targetCurrency: TargetCurrency.BRL,
  }

  public readonly currency = TargetCurrency.BRL
  public readonly isEnabled = true
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION = Number.POSITIVE_INFINITY
  public readonly MIN_USER_AMOUNT_PER_TRANSACTION = 1
  public readonly provider = 'transfero'

  private readonly logger: ScopedLogger

  public constructor(
    @inject(TransferoUltraClient) private readonly ultraClient: TransferoUltraClient,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoPixDeposit' })
  }

  public async createDeposit(params: {
    amount: number
    reference: string
    transactionId: string
  }): Promise<FiatDepositCreateResult> {
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return { code: 'validation', reason: 'transfero_ultra_deposit_amount_invalid', success: false }
    }

    const txid = this.buildDynamicTxid(params.transactionId)
    if (!txid) {
      return { code: 'validation', reason: 'transfero_ultra_deposit_txid_invalid', success: false }
    }

    try {
      const response = await this.ultraClient.post(
        '/api/v1/pix/qr-codes/dynamic',
        {
          amount: params.amount,
          // Attribution for the deposit reads and every pix.deposit.* webhook.
          endUserId: params.reference,
          txid,
        },
        this.buildIdempotencyKey('pix-deposit', params.transactionId),
      )
      const parsed = transferoUltraDynamicQrResponseSchema.parse(response)
      const brCode = parsed.brCode ?? parsed.emvPayload
      if (!brCode) {
        this.logger.error('Transfero Ultra dynamic QR response carried no BR Code', {
          depositId: parsed.depositId,
          transactionId: params.transactionId,
        })
        return {
          code: 'permanent',
          reason: 'transfero_ultra_deposit_missing_brcode',
          success: false,
        }
      }

      return {
        brCode,
        expiresAt: this.parseDate(parsed.expiresAt),
        providerDepositId: parsed.depositId,
        success: true,
      }
    }
    catch (error) {
      return this.toFailure(error, 'deposit_create')
    }
  }

  public async getDepositFacts(providerDepositId: string): Promise<FiatDepositFactsResult> {
    try {
      const response = await this.ultraClient.get(
        `/api/v1/pix/deposits/${encodeURIComponent(providerDepositId)}`,
      )
      const parsed = transferoUltraDepositDetailResponseSchema.parse(response)
      const amount = Number(parsed.amount)
      if (!Number.isFinite(amount) || amount < 0) {
        return {
          code: 'permanent',
          reason: 'transfero_ultra_deposit_amount_unreadable',
          success: false,
        }
      }

      const status = DEPOSIT_STATUS_BY_ULTRA_STATUS[parsed.status]
      if (!status) {
        this.logger.error('Transfero Ultra deposit carried an unmapped status', {
          providerDepositId,
          status: parsed.status,
        })
        return {
          code: 'permanent',
          reason: 'transfero_ultra_deposit_status_unmapped',
          success: false,
        }
      }

      return {
        facts: {
          amount,
          endToEndId: parsed.endToEndId?.trim() || null,
          payerTaxId: parsed.payer?.taxId?.replace(/\D+/g, '') || null,
          providerDepositId: parsed.depositId,
          status,
        },
        success: true,
      }
    }
    catch (error) {
      return this.toFailure(error, 'deposit_read')
    }
  }

  public async refundDeposit(params: {
    providerDepositId: string
    transactionId: string
  }): Promise<FiatDepositRefundResult> {
    try {
      const response = await this.ultraClient.post(
        '/api/v1/pix/refunds',
        { depositId: params.providerDepositId },
        this.buildIdempotencyKey('pix-refund', params.transactionId),
      )
      const parsed = transferoUltraRefundResponseSchema.parse(response)
      return { providerRefundId: parsed.id, success: true }
    }
    catch (error) {
      return this.toFailure(error, 'deposit_refund')
    }
  }

  /**
   * Deterministic per transaction, so a retried acceptance re-presents the same
   * QR instead of opening a second one the customer could also pay.
   */
  private buildDynamicTxid(transactionId: string): null | string {
    const candidate = transactionId.replace(/[^0-9a-zA-Z]/g, '')
    if (
      candidate.length >= MIN_ULTRA_DYNAMIC_TXID_LENGTH
      && candidate.length <= MAX_ULTRA_DYNAMIC_TXID_LENGTH
    ) {
      return candidate
    }
    if (candidate.length > MAX_ULTRA_DYNAMIC_TXID_LENGTH) {
      return candidate.slice(0, MAX_ULTRA_DYNAMIC_TXID_LENGTH)
    }
    const digest = createHash('sha256').update(transactionId).digest('hex')
    return digest.slice(0, 32)
  }

  private buildIdempotencyKey(operation: string, transactionId: string): string {
    const candidate = `abroad:${operation}:${transactionId}`
    if (candidate.length <= 255) {
      return candidate
    }
    const digest = createHash('sha256').update(transactionId).digest('hex')
    return `abroad:${operation}:${digest}`
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown_error'
  }

  private parseDate(value: null | string | undefined): Date | null {
    if (!value) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  private toFailure(
    error: unknown,
    operation: string,
  ): { code: FiatDepositFailureCode, reason: string, success: false } {
    if (error instanceof TransferoUltraError) {
      return { code: error.code, reason: error.message, success: false }
    }
    if (error instanceof ZodError) {
      this.logger.error('Transfero Ultra deposit response schema mismatch', {
        issues: error.issues,
        operation,
      })
      return {
        code: 'permanent',
        reason: `transfero_ultra_${operation}_schema_mismatch`,
        success: false,
      }
    }
    return { code: 'retriable', reason: this.describeError(error), success: false }
  }
}
