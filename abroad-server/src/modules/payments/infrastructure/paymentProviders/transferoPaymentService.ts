import { PaymentMethod, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { ZodError } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { buildIdempotencyKey } from '../../../../platform/http/idempotencyKey'
import { TransferoUltraClient, TransferoUltraError } from '../../../transfero/infrastructure/TransferoUltraClient'
import { transferoUltraBalanceResponseSchema, transferoUltraWithdrawalDetailResponseSchema, transferoUltraWithdrawalResponseSchema } from '../../../transfero/infrastructure/transferoUltraSchemas'
import {
  IPaymentService,
  PaymentCapability,
  PaymentFactsResult,
  PaymentFailureCode,
  PaymentOnboardResult,
  PaymentSendResult,
} from '../../application/contracts/IPaymentService'
import { IPixQrDecoder } from '../../application/contracts/IQrDecoder'

type TransferoUltraPixKeyType = 'CNPJ' | 'CPF' | 'EMAIL' | 'EVP' | 'PHONE'

type TransferoUltraWithdrawalRequest
  = | TransferoUltraWithdrawalRequestBase & {
    brcode: string
  }
  | TransferoUltraWithdrawalRequestBase & {
    pixKey: string
    pixKeyType: TransferoUltraPixKeyType
  }

type TransferoUltraWithdrawalRequestBase = {
  amount: number
  description: string
  idempotencyKey: string
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
  private readonly rateLimitCooldownMs: number
  private readonly retryDelayMs: number
  private withdrawalRateLimitedUntilMs = 0

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
    this.rateLimitCooldownMs = this.readPositiveInteger(
      'TRANSFERO_ULTRA_RATE_LIMIT_COOLDOWN_MS',
      60_000,
    )
  }

  /**
   * Rejects when the balance cannot be read, per the IPaymentService contract —
   * a provider failure must never be reported as a zero float.
   */
  public getLiquidity = async (): Promise<number> => {
    let balances: ReturnType<typeof transferoUltraBalanceResponseSchema.parse>
    try {
      const response = await this.ultraClient.get('/api/v1/balance')
      balances = transferoUltraBalanceResponseSchema.parse(response)
    }
    catch (error) {
      this.logger.error('Transfero Ultra liquidity request failed', this.describeError(error))
      throw error instanceof Error ? error : new Error('Transfero Ultra liquidity request failed')
    }

    const brz = balances.find(balance => balance.asset.toUpperCase() === 'BRZ')
    if (!brz) {
      this.logger.error('Transfero Ultra balance response omitted BRZ')
      throw new Error('Transfero Ultra balance response omitted BRZ')
    }

    const amount = Number(brz.available)
    if (!Number.isFinite(amount)) {
      this.logger.error('Transfero Ultra BRZ available balance is invalid')
      throw new Error('Transfero Ultra BRZ available balance is invalid')
    }
    return Math.max(0, amount)
  }

  public async getPaymentFacts(providerTransactionId: string): Promise<PaymentFactsResult> {
    try {
      const response = await this.ultraClient.get(
        `/api/v1/pix/withdrawals/${encodeURIComponent(providerTransactionId)}`,
      )
      const withdrawal = transferoUltraWithdrawalDetailResponseSchema.parse(response)
      return {
        ...(withdrawal.fee !== undefined && withdrawal.netAmount !== undefined
          ? {
              economics: {
                feeCurrency: TargetCurrency.BRL,
                feeNative: String(withdrawal.fee),
                netAmountNative: String(withdrawal.netAmount),
              },
            }
          : {}),
        success: true as const,
      }
    }
    catch {
      return {
        reason: 'withdrawal_read_failed',
        success: false as const,
      }
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

    const withdrawalKey = buildIdempotencyKey(['abroad', 'pix-withdrawal'], params.id)
    const requestResult = await this.buildWithdrawalRequest({
      ...params,
      withdrawalKey,
    })
    if (!requestResult.success) {
      return requestResult
    }
    if (Date.now() < this.withdrawalRateLimitedUntilMs) {
      return this.buildFailure(
        'retriable',
        'transfero_ultra_withdrawal_rate_limit_cooldown',
      )
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
        return {
          economics: {
            feeCurrency: TargetCurrency.BRL,
            feeNative: String(withdrawal.fee),
            netAmountNative: String(withdrawal.netAmount),
          },
          success: true,
          transactionId: withdrawal.id,
        }
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
        if (error instanceof TransferoUltraError && error.status === 429) {
          this.withdrawalRateLimitedUntilMs = Date.now() + this.rateLimitCooldownMs
          return failure
        }
        if (failure.code !== 'retriable' || attempt === this.maxSendAttempts) {
          return failure
        }
        await this.sleep(this.calculateRetryDelayMs(attempt))
      }
    }

    return this.buildFailure('retriable', 'pix_withdrawal_attempts_exhausted')
  }

  public verifyAccount({ account }: { account: string }): Promise<boolean> {
    return Promise.resolve(this.buildPixDestination(account) !== null)
  }

  private buildFailure(
    code: PaymentFailureCode,
    reason: string,
  ): Extract<PaymentSendResult, { success: false }> {
    return { code, reason, success: false }
  }

  private buildPixDestination(account: string): null | {
    pixKey: string
    pixKeyType: TransferoUltraPixKeyType
  } {
    const trimmed = account.trim()
    if (!trimmed) return null

    if (this.isEmailPixKey(trimmed)) {
      return { pixKey: trimmed, pixKeyType: 'EMAIL' }
    }
    if (this.isEvpPixKey(trimmed)) {
      return { pixKey: trimmed.toLowerCase(), pixKeyType: 'EVP' }
    }

    const digits = trimmed.replace(/\D+/g, '')
    if (this.isValidCpf(digits)) {
      return { pixKey: digits, pixKeyType: 'CPF' }
    }
    if (this.isValidCnpj(digits)) {
      return { pixKey: digits, pixKeyType: 'CNPJ' }
    }

    const normalizedBrazilPhone = this.normalizeBrazilPhoneNumber(account)
    return normalizedBrazilPhone
      ? { pixKey: `+55${normalizedBrazilPhone}`, pixKeyType: 'PHONE' }
      : null
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
      const destination = this.buildPixDestination(params.account)
      if (!destination) {
        return {
          code: 'validation',
          reason: 'pix_key_type_unsupported',
          success: false,
        }
      }
      return {
        request: {
          amount: params.value,
          description,
          idempotencyKey: params.withdrawalKey,
          ...destination,
        },
        success: true,
      }
    }

    const preview = await this.pixQrDecoder.validateForPayment({
      idempotencyKey: buildIdempotencyKey(['abroad', 'pix-preview'], params.id),
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

  private calculateCheckDigit(baseDigits: string, weights: readonly number[]): number {
    const sum = weights.reduce(
      (total, weight, index) => total + Number(baseDigits[index]) * weight,
      0,
    )
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }

  private calculateRetryDelayMs(attempt: number): number {
    const exponentialDelay = Math.min(
      30_000,
      this.retryDelayMs * (2 ** Math.max(0, attempt - 1)),
    )
    return exponentialDelay + Math.floor(Math.random() * exponentialDelay)
  }

  private describeError(error: unknown): string {
    if (error instanceof TransferoUltraError) return error.message
    if (error instanceof ZodError) return 'transfero_ultra_response_schema_mismatch'
    return error instanceof Error ? error.message : 'transfero_ultra_unknown_error'
  }

  private hasValidLength(digits: string): boolean {
    return digits.length === 10 || digits.length === 11
  }

  private isEmailPixKey(value: string): boolean {
    return value.length <= 255
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  }

  private isEvpPixKey(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  }

  private isTollFreeNumber(digits: string): boolean {
    return /^0800\d{7}$/.test(digits)
  }

  private isValidCnpj(digits: string): boolean {
    if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false
    const first = this.calculateCheckDigit(
      digits.slice(0, 12),
      [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    )
    const second = this.calculateCheckDigit(
      `${digits.slice(0, 12)}${first}`,
      [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    )
    return digits.endsWith(`${first}${second}`)
  }

  private isValidCpf(digits: string): boolean {
    if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false
    const first = this.calculateCheckDigit(
      digits.slice(0, 9),
      [10, 9, 8, 7, 6, 5, 4, 3, 2],
    )
    const second = this.calculateCheckDigit(
      `${digits.slice(0, 9)}${first}`,
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    )
    return digits.endsWith(`${first}${second}`)
  }

  private isValidLocalNumber(local: string): boolean {
    if (local.length === 8) {
      return /^[2-5]\d{7}$/.test(local)
    }
    return local.length === 9 && /^9\d{8}$/.test(local)
  }

  private normalizeBrazilPhoneNumber(input: string): null | string {
    const trimmed = input.trim()
    const digits = trimmed.replace(/\D+/g, '')
    if (!digits) return null

    const domesticDigits = this.removeBrazilCountryCode(trimmed, digits)
    if (domesticDigits === null) return null
    if (this.isTollFreeNumber(domesticDigits)) return domesticDigits

    const normalized = this.removeCarrierPrefix(domesticDigits)
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

  private removeBrazilCountryCode(input: string, digits: string): null | string {
    if (!input.startsWith('+')) return digits
    return digits.startsWith('55') ? digits.slice(2) : null
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
