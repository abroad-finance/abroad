import { PaymentMethod, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { createHash } from 'node:crypto'
import { ZodError } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { TransferoUltraClient, TransferoUltraError } from '../../../transfero/infrastructure/TransferoUltraClient'
import { transferoUltraBalanceResponseSchema, transferoUltraWithdrawalResponseSchema } from '../../../transfero/infrastructure/transferoUltraSchemas'
import {
  IPaymentService,
  PaymentCapability,
  PaymentFailureCode,
  PaymentOnboardResult,
  PaymentSendResult,
} from '../../application/contracts/IPaymentService'
import { IPixQrDecoder } from '../../application/contracts/IQrDecoder'

type TransferoUltraWithdrawalRequest = {
  amount: number
  brcode?: string
  description: string
  idempotencyKey: string
  pixKey?: string
}

const TERMINAL_FAILURE_STATUSES = new Set([
  'CANCELLED',
  'FAILED',
  'REJECTED',
  'RETURNED',
])

@injectable()
export class TransferoPaymentService implements IPaymentService {
  public readonly capability: PaymentCapability = {
    method: PaymentMethod.PIX,
    targetCurrency: TargetCurrency.BRL,
  }

  public readonly currency = TargetCurrency.BRL
  public readonly fixedFee = 0
  public readonly isAsync = true
  public readonly isEnabled = true
  public readonly MAX_TOTAL_AMOUNT_PER_DAY = Number.POSITIVE_INFINITY
  public readonly MAX_USER_AMOUNT_PER_DAY = Number.POSITIVE_INFINITY
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION = Number.POSITIVE_INFINITY
  public readonly MAX_USER_TRANSACTIONS_PER_DAY = Number.POSITIVE_INFINITY
  public readonly MIN_USER_AMOUNT_PER_TRANSACTION = 1
  public readonly percentageFee = 0
  public readonly provider = 'transfero'

  private readonly brazilDdds = new Set([
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46',
    '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99',
  ])

  private readonly logger: ScopedLogger
  private readonly maxSendAttempts: number
  private readonly retryDelayMs: number

  public constructor(
    @inject(TransferoUltraClient) private readonly ultraClient: TransferoUltraClient,
    @inject(TYPES.IPixQrDecoder) private readonly pixQrDecoder: IPixQrDecoder,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoUltraPaymentService' })
    this.maxSendAttempts = this.readPositiveInteger(
      'TRANSFERO_ULTRA_MAX_SEND_ATTEMPTS',
      3,
    )
    this.retryDelayMs = this.readPositiveInteger(
      'TRANSFERO_ULTRA_RETRY_DELAY_MS',
      250,
    )
  }

  public getLiquidity = async (): Promise<number> => {
    try {
      const response = await this.ultraClient.get('/api/v1/balance')
      const balances = transferoUltraBalanceResponseSchema.parse(response)
      const brz = balances.find(balance => balance.asset.toUpperCase() === 'BRZ')
      if (!brz) {
        this.logger.error('Transfero Ultra balance response omitted BRZ')
        return 0
      }

      const amount = Number(brz.available)
      if (!Number.isFinite(amount)) {
        this.logger.error('Transfero Ultra BRZ available balance is invalid')
        return 0
      }
      return Math.max(0, amount)
    }
    catch (error) {
      this.logger.error('Transfero Ultra liquidity request failed', this.describeError(error))
      return 0
    }
  }

  public onboardUser(): Promise<PaymentOnboardResult> {
    return Promise.resolve({
      message: 'Transfero Ultra partner onboarding is managed out of band.',
      success: true,
    })
  }

  public async sendPayment(params: {
    account: string
    id: string
    qrCode?: null | string
    value: number
  }): Promise<PaymentSendResult> {
    if (!Number.isFinite(params.value) || params.value < this.MIN_USER_AMOUNT_PER_TRANSACTION) {
      return this.buildFailure('validation', 'pix_withdrawal_amount_below_minimum')
    }
    if (!params.qrCode && !params.account.trim()) {
      return this.buildFailure('validation', 'pix_key_required')
    }

    const withdrawalKey = this.buildIdempotencyKey('pix-withdrawal', params.id)
    const requestResult = await this.buildWithdrawalRequest({
      ...params,
      withdrawalKey,
    })
    if (!requestResult.success) {
      return requestResult
    }

    for (let attempt = 1; attempt <= this.maxSendAttempts; attempt += 1) {
      try {
        const response = await this.ultraClient.post(
          '/api/v1/pix/withdrawals',
          requestResult.request,
          withdrawalKey,
        )
        const withdrawal = transferoUltraWithdrawalResponseSchema.parse(response)
        if (Math.abs(withdrawal.amount - params.value) > 0.005) {
          this.logger.error('Transfero Ultra withdrawal amount did not match request', {
            requestedAmount: params.value,
            responseAmount: withdrawal.amount,
            withdrawalId: withdrawal.id,
          })
          return this.buildFailure(
            'permanent',
            'transfero_ultra_withdrawal_amount_mismatch',
          )
        }
        if (TERMINAL_FAILURE_STATUSES.has(withdrawal.status)) {
          return this.buildFailure(
            'permanent',
            `pix_withdrawal_created_in_terminal_state:${withdrawal.status}`,
          )
        }

        this.logger.info('Transfero Ultra PIX withdrawal submitted', {
          requiresApproval: withdrawal.requiresApproval,
          status: withdrawal.status,
          withdrawalId: withdrawal.id,
        })
        return { success: true, transactionId: withdrawal.id }
      }
      catch (error) {
        const failure = this.toPaymentFailure(error)
        this.logger.warn('Transfero Ultra PIX withdrawal attempt failed', {
          attempt,
          code: failure.code,
          providerCode: error instanceof TransferoUltraError
            ? error.providerCode
            : undefined,
          status: error instanceof TransferoUltraError ? error.status : undefined,
        })
        if (failure.code !== 'retriable' || attempt === this.maxSendAttempts) {
          return failure
        }
        await this.sleep(this.retryDelayMs * attempt)
      }
    }

    return this.buildFailure('retriable', 'pix_withdrawal_attempts_exhausted')
  }

  public verifyAccount({ account }: { account: string }): Promise<boolean> {
    return Promise.resolve(account.trim().length > 0)
  }

  private buildFailure(
    code: PaymentFailureCode,
    reason: string,
  ): Extract<PaymentSendResult, { success: false }> {
    return { code, reason, success: false }
  }

  private buildIdempotencyKey(operation: string, transactionId: string): string {
    const candidate = `abroad:${operation}:${transactionId}`
    if (candidate.length <= 255) {
      return candidate
    }
    const digest = createHash('sha256').update(transactionId).digest('hex')
    return `abroad:${operation}:${digest}`
  }

  private buildPixKey(account: string): string {
    const normalizedBrazilPhone = this.normalizeBrazilPhoneNumber(account)
    return normalizedBrazilPhone ? `+55${normalizedBrazilPhone}` : account.trim()
  }

  private async buildWithdrawalRequest(params: {
    account: string
    id: string
    qrCode?: null | string
    value: number
    withdrawalKey: string
  }): Promise<
    | { code: PaymentFailureCode, reason: string, success: false }
    | { request: TransferoUltraWithdrawalRequest, success: true }
  > {
    const description = `Abroad payout ${params.id}`.slice(0, 140)
    if (!params.qrCode) {
      return {
        request: {
          amount: params.value,
          description,
          idempotencyKey: params.withdrawalKey,
          pixKey: this.buildPixKey(params.account),
        },
        success: true,
      }
    }

    const preview = await this.pixQrDecoder.validateForPayment({
      idempotencyKey: this.buildIdempotencyKey('pix-preview', params.id),
      qrCode: params.qrCode,
    })
    if (!preview.success) {
      return preview
    }

    const previewAmount = preview.decoded.amount === undefined
      ? undefined
      : Number(preview.decoded.amount)
    if (
      previewAmount !== undefined
      && (!Number.isFinite(previewAmount) || Math.abs(previewAmount - params.value) > 0.005)
    ) {
      return {
        code: 'validation',
        reason: 'pix_qr_amount_mismatch',
        success: false,
      }
    }

    return {
      request: {
        amount: params.value,
        brcode: params.qrCode,
        description,
        idempotencyKey: params.withdrawalKey,
      },
      success: true,
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof TransferoUltraError) return error.message
    if (error instanceof ZodError) return 'transfero_ultra_response_schema_mismatch'
    return error instanceof Error ? error.message : 'transfero_ultra_unknown_error'
  }

  private hasValidLength(digits: string): boolean {
    return digits.length === 10 || digits.length === 11
  }

  private isTollFreeNumber(digits: string): boolean {
    return /^0800\d{7}$/.test(digits)
  }

  private isValidLocalNumber(local: string): boolean {
    if (local.length === 8) {
      return /^[2-5]\d{7}$/.test(local)
    }
    return local.length === 9 && /^9\d{8}$/.test(local)
  }

  private normalizeBrazilPhoneNumber(input: string): null | string {
    const digits = input.replace(/\D+/g, '')
    if (!digits) return null
    if (this.isTollFreeNumber(digits)) return digits

    const normalized = this.removeCarrierPrefix(digits)
    if (!this.hasValidLength(normalized)) return null

    const ddd = normalized.slice(0, 2)
    const local = normalized.slice(2)
    return this.brazilDdds.has(ddd) && this.isValidLocalNumber(local)
      ? normalized
      : null
  }

  private readPositiveInteger(envKey: string, fallback: number): number {
    const parsed = Number(process.env[envKey])
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
  }

  private removeCarrierPrefix(digits: string): string {
    if (/^0\d{2}\d{10,11}$/.test(digits)) return digits.slice(3)
    return digits.length >= 11 && digits.startsWith('0') ? digits.slice(1) : digits
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  private toPaymentFailure(
    error: unknown,
  ): Extract<PaymentSendResult, { success: false }> {
    if (error instanceof TransferoUltraError) {
      return this.buildFailure(error.code, error.message)
    }
    if (error instanceof ZodError) {
      this.logger.error('Transfero Ultra withdrawal response schema mismatch', {
        issues: error.issues,
      })
      return this.buildFailure('permanent', 'transfero_ultra_withdrawal_schema_mismatch')
    }
    return this.buildFailure('retriable', this.describeError(error))
  }
}
