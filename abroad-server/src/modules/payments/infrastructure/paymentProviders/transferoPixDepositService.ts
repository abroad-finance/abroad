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

    try {
      const response = await this.ultraClient.post(
        '/api/v1/pix/qr-codes/dynamic',
        {
          // The endpoint accepts exactly `amount` and `endUserId`; the txid the
          // PIX spec describes is minted by Ultra, and sending one is rejected
          // as an unrecognised key. Idempotency is carried by the header alone.
          amount: params.amount,
          // Attribution for the deposit reads and every pix.deposit.* webhook.
          endUserId: params.reference,
        },
        this.buildIdempotencyKey('pix-deposit', params.transactionId),
      )
      const parsed = transferoUltraDynamicQrResponseSchema.parse(response)

      return {
        brCode: parsed.qrCode,
        expiresAt: this.parseDate(parsed.expiresAt),
        providerDepositId: parsed.id,
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
          providerDepositId: parsed.id,
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
