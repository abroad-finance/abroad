import {
  KycStatus,
  KYCTier,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { isKycExemptByAmount } from '../../../app/config/kyc'
import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { QueueName } from '../../../platform/messaging/queues'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IKycService } from '../../kyc/application/contracts/IKycService'
import { getNextTier, type KycCountry } from '../../kyc/application/kycTierRules'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { uuidToBase64 } from '../infrastructure/transactionEncoding'
import { toWebhookTransactionPayload } from './transactionPayload'

interface AcceptTransactionRequest {
  accountNumber: string
  qrCode?: null | string
  quoteId: string
  redirectUrl?: string
  taxId?: string
  userId: string
}

interface AcceptTransactionResponse {
  id: null | string
  kycLink: null | string
  transactionReference: null | string
}

type DatabaseClient = Awaited<ReturnType<IDatabaseClientProvider['getClient']>>

type PartnerUserContext = {
  id: string
  isKybApproved: boolean
  needsKyc: boolean
  webhookUrl: string
}
type PaymentServiceInstance = ReturnType<IPaymentServiceFactory['getPaymentService']>
type PrismaClientLike = DatabaseClient | SerializableTx
type SerializableTx = Prisma.TransactionClient
type TransactionDecision
  = | {
    outcome: 'kyc'
    partnerUserId: string
    quote: { country: string }
    totalUserAmountMonthly: number
  }
  | {
    outcome: 'transaction'
    partnerUserId: string
    quoteId: string
    transaction: { id: string }
  }

@injectable()
export class TransactionAcceptanceService {
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPaymentServiceFactory)
    private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IKycService) private readonly kycService: IKycService,
    @inject(TYPES.IOutboxDispatcher) private readonly outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ILogger) logger: ILogger,
  ) {
    this.logger = createScopedLogger(logger, { scope: 'TransactionAcceptance' })
  }

  public async acceptTransaction(
    request: AcceptTransactionRequest,
    partner: PartnerUserContext,
  ): Promise<AcceptTransactionResponse> {
    const prismaClient = await this.prismaClientProvider.getClient()
    let decision: TransactionDecision
    try {
      decision = await prismaClient.$transaction<TransactionDecision>(async (tx) => {
        const quote = await this.fetchQuote(tx, request.quoteId, partner.id)
        const basePaymentService = this.paymentServiceFactory.getPaymentService(quote.paymentMethod)
        const paymentService = this.paymentServiceFactory.getPaymentServiceForCapability?.({
          paymentMethod: quote.paymentMethod,
          targetCurrency: quote.targetCurrency,
        }) ?? basePaymentService
        this.assertPaymentServiceIsEnabled(paymentService, quote.paymentMethod)
        await this.lockPaymentMethod(tx, quote.paymentMethod)

        this.enforceTransactionAmountBounds(quote, paymentService, quote.paymentMethod)
        await this.ensureAccountIsValid(paymentService, request.accountNumber)

        const partnerUser = await tx.partnerUser.upsert({
          create: {
            partnerId: quote.partnerId,
            userId: request.userId,
          },
          update: {},
          where: {
            partnerId_userId: {
              partnerId: quote.partnerId,
              userId: request.userId,
            },
          },
        })
        await this.lockPartnerUser(tx, partnerUser.id)
        await this.lockPartner(tx, partner.id)

        const monthlyAmount = await this.calculateMonthlyAmount(tx, partnerUser.id, quote.paymentMethod)
        const totalUserAmountMonthly = monthlyAmount + quote.sourceAmount
        const shouldRequestKyc = await this.shouldRequestKyc(
          tx,
          partner,
          partnerUser.id,
          totalUserAmountMonthly,
          quote.country,
        )
        if (shouldRequestKyc) {
          return {
            outcome: 'kyc',
            partnerUserId: partnerUser.id,
            quote: { country: quote.country },
            totalUserAmountMonthly,
          } as const
        }

        await this.enforceUserTransactionLimits(tx, partnerUser.id, quote, paymentService)
        await this.enforcePaymentMethodLimits(tx, quote, paymentService)
        await this.enforceLiquidity(paymentService, quote.targetAmount)
        await this.enforcePartnerKybThreshold(tx, partner.id, quote.sourceAmount, partner.isKybApproved)
        await this.reserveUserMonthlyLimits(tx, partnerUser.id, quote.paymentMethod, quote.targetAmount, paymentService)
        await this.reservePartnerMonthlyLimits(tx, partner.id, quote.paymentMethod, quote.targetAmount, paymentService)
        await this.reserveUserDailyLimits(tx, partnerUser.id, quote.paymentMethod, quote.targetAmount, paymentService)
        await this.reservePartnerDailyLimits(tx, partner.id, quote.paymentMethod, quote.targetAmount, paymentService)

        const transaction = await tx.transaction.create({
          data: {
            accountNumber: request.accountNumber,
            partnerUserId: partnerUser.id,
            qrCode: request.qrCode,
            quoteId: quote.id,
            status: TransactionStatus.AWAITING_PAYMENT,
            taxId: request.taxId,
          },
          select: { bankCode: true, id: true },
        })

        const payload = toWebhookTransactionPayload(transaction)

        try {
          await this.outboxDispatcher.enqueueWebhook(
            partner.webhookUrl,
            { data: payload, event: WebhookEvent.TRANSACTION_CREATED },
            'transaction.created',
            { client: tx, deliverNow: false },
          )
          await this.publishUserNotification(tx, transaction.id, request.userId)
        }
        catch (error) {
          this.logger.error('Error enqueuing transaction.created notifications', error)
          throw new TransactionValidationError('We could not create your transaction right now. Please try again in a few moments.')
        }

        return {
          outcome: 'transaction',
          partnerUserId: partnerUser.id,
          quoteId: quote.id,
          transaction,
        } as const
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: this.interactiveTransactionMaxWaitMs(),
        timeout: this.interactiveTransactionTimeoutMs(),
      })
    }
    catch (error) {
      if (error instanceof TransactionValidationError) {
        throw error
      }
      this.logger.error('Failed to accept transaction', error)
      throw new TransactionValidationError('We could not create your transaction right now. Please try again in a few moments.')
    }

    if (decision.outcome === 'kyc') {
      const kycLink = await this.resolveKycLinkAfterDecision(
        decision.totalUserAmountMonthly,
        decision.quote.country,
        request.redirectUrl,
        decision.partnerUserId,
      )

      return {
        id: null,
        kycLink,
        transactionReference: null,
      }
    }

    const transactionReference = uuidToBase64(decision.transaction.id)
    return {
      id: decision.transaction.id,
      kycLink: null,
      transactionReference,
    }
  }

  private async aggregateCompletedQuotes(
    prismaClient: SerializableTx,
    where: Prisma.QuoteWhereInput,
  ): Promise<{ count: number, sourceAmount: number, targetAmount: number }> {
    const aggregate = await prismaClient.quote.aggregate({
      _count: { _all: true },
      _sum: { sourceAmount: true, targetAmount: true },
      where,
    })

    return {
      count: aggregate._count?._all ?? 0,
      sourceAmount: aggregate._sum?.sourceAmount ?? 0,
      targetAmount: aggregate._sum?.targetAmount ?? 0,
    }
  }

  private assertPaymentServiceIsEnabled(paymentService: PaymentServiceInstance, paymentMethod: PaymentMethod): void {
    if (!paymentService.isEnabled) {
      throw new TransactionValidationError(`Payments via ${paymentMethod} are temporarily unavailable. Please try another method or retry shortly.`)
    }
  }

  private async calculateMonthlyAmount(
    prismaClient: SerializableTx,
    partnerUserId: string,
    paymentMethod: PaymentMethod,
  ): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const aggregate = await this.aggregateCompletedQuotes(prismaClient, {
      paymentMethod,
      transaction: {
        is: {
          createdAt: { gte: thirtyDaysAgo },
          partnerUserId,
          status: TransactionStatus.PAYMENT_COMPLETED,
        },
      },
    })

    return aggregate.sourceAmount
  }

  private async enforceLiquidity(
    paymentService: PaymentServiceInstance,
    targetAmount: number,
  ) {
    let availableLiquidity = 0
    try {
      availableLiquidity = await paymentService.getLiquidity()
    }
    catch (err) {
      this.logger.warn('Failed to fetch payment service liquidity', err)
      availableLiquidity = 0
    }

    if (targetAmount > availableLiquidity) {
      throw new TransactionValidationError('We cannot process this payout because liquidity for this method is below the requested amount. Try a smaller amount or choose another payment method.')
    }
  }

  private async enforcePartnerKybThreshold(
    prismaClient: SerializableTx,
    partnerId: string,
    sourceAmount: number,
    isKybApproved: boolean,
  ) {
    if (isKybApproved) {
      return
    }

    const aggregate = await this.aggregateCompletedQuotes(prismaClient, {
      transaction: {
        is: {
          partnerUser: { partnerId },
          status: TransactionStatus.PAYMENT_COMPLETED,
        },
      },
    })
    const partnerTotalAmount = aggregate.sourceAmount
    if (partnerTotalAmount + sourceAmount > 100) {
      throw new TransactionValidationError('This partner is limited to a total of $100 until KYB is approved. Please complete KYB to raise the limit.')
    }
  }

  private async enforcePaymentMethodLimits(
    prismaClient: SerializableTx,
    quote: { paymentMethod: PaymentMethod, targetAmount: number },
    paymentService: PaymentServiceInstance,
  ) {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0))
    const aggregate = await this.aggregateCompletedQuotes(prismaClient, {
      paymentMethod: quote.paymentMethod,
      transaction: {
        is: {
          createdAt: { gte: todayStart },
          status: TransactionStatus.PAYMENT_COMPLETED,
        },
      },
    })
    const totalAmountToday = aggregate.targetAmount
    if (totalAmountToday + quote.targetAmount > paymentService.MAX_TOTAL_AMOUNT_PER_DAY) {
      throw new TransactionValidationError('This payment method already reached today\'s payout limit. Please try again tomorrow or use another method.')
    }
  }

  private enforceTransactionAmountBounds(
    quote: { targetAmount: number, targetCurrency: TargetCurrency },
    paymentService: PaymentServiceInstance,
    paymentMethod: PaymentMethod,
  ): void {
    if (quote.targetAmount < paymentService.MIN_USER_AMOUNT_PER_TRANSACTION) {
      throw new TransactionValidationError(`Payouts via ${paymentMethod} must be at least ${paymentService.MIN_USER_AMOUNT_PER_TRANSACTION} ${quote.targetCurrency}. Increase the amount and try again.`)
    }

    if (quote.targetAmount > paymentService.MAX_USER_AMOUNT_PER_TRANSACTION) {
      throw new TransactionValidationError(`Payouts via ${paymentMethod} cannot exceed ${paymentService.MAX_USER_AMOUNT_PER_TRANSACTION} ${quote.targetCurrency}. Lower the amount or choose another method.`)
    }
  }

  private async enforceUserTransactionLimits(
    prismaClient: SerializableTx,
    partnerUserId: string,
    quote: { paymentMethod: PaymentMethod, targetAmount: number },
    paymentService: PaymentServiceInstance,
  ) {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0))
    const aggregate = await this.aggregateCompletedQuotes(prismaClient, {
      paymentMethod: quote.paymentMethod,
      transaction: {
        is: {
          createdAt: { gte: todayStart },
          partnerUserId,
          status: TransactionStatus.PAYMENT_COMPLETED,
        },
      },
    })

    const count = aggregate.count
    if (count >= paymentService.MAX_USER_TRANSACTIONS_PER_DAY) {
      throw new TransactionValidationError('You reached the maximum number of transactions allowed today. Please try again tomorrow.')
    }

    const totalUserAmount = aggregate.targetAmount
    if (totalUserAmount + quote.targetAmount > paymentService.MAX_TOTAL_AMOUNT_PER_DAY) {
      throw new TransactionValidationError('This transaction would exceed your daily limit for this payment method. Lower the amount or try again tomorrow.')
    }
  }

  private async ensureAccountIsValid(
    paymentService: PaymentServiceInstance,
    accountNumber: string,
  ) {
    const isAccountValid = await paymentService.verifyAccount({ account: accountNumber })
    if (!isAccountValid) {
      throw new TransactionValidationError('We could not verify the account number provided. Please double-check the details and try again.')
    }
  }

  private async fetchApprovedKycTier(
    prismaClient: SerializableTx,
    partnerUserId: string,
  ): Promise<KYCTier> {
    const approvedKyc = await prismaClient.partnerUserKyc.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { partnerUserId, status: KycStatus.APPROVED },
    })

    return approvedKyc?.tier ?? KYCTier.NONE
  }

  private async fetchQuote(prismaClient: SerializableTx, quoteId: string, partnerId: string) {
    const quote = await prismaClient.quote.findUnique({
      where: { id: quoteId, partnerId },
    })

    if (!quote) {
      throw new TransactionValidationError('We could not find a valid quote for this request. Please generate a new quote and try again.')
    }

    return quote
  }

  private async lockPartner(
    prismaClient: SerializableTx,
    partnerId: string,
  ): Promise<void> {
    // Coarse lock to serialize partner-level aggregate checks.
    await prismaClient.$executeRaw`SELECT 1 FROM "Partner" WHERE id = ${partnerId} FOR UPDATE`
  }

  private async lockPartnerUser(
    prismaClient: SerializableTx,
    partnerUserId: string,
  ): Promise<void> {
    // Serialize concurrent accept attempts for the same partner user to prevent limit races.
    await prismaClient.$executeRaw`SELECT 1 FROM "PartnerUser" WHERE id = ${partnerUserId} FOR UPDATE`
  }

  private async lockPaymentMethod(
    prismaClient: SerializableTx,
    paymentMethod: PaymentMethod,
  ): Promise<void> {
    // Prevent concurrent acceptances from racing on method-level daily totals.
    await prismaClient.$executeRaw`SELECT 1 FROM "PaymentProvider" WHERE id = ${paymentMethod} FOR UPDATE`
  }

  private static readonly UNBOUNDED_AMOUNT_CAP = Number.MAX_SAFE_INTEGER
  private static readonly UNBOUNDED_COUNT_CAP = 2_147_483_647

  // Prisma serializes non-finite numbers as NULL in SQL. Use finite sentinels for cap checks.
  private normalizeAmountCap(value: number): number {
    return Number.isFinite(value) ? value : TransactionAcceptanceService.UNBOUNDED_AMOUNT_CAP
  }

  private normalizeCountCap(value: number): number {
    return Number.isFinite(value) ? value : TransactionAcceptanceService.UNBOUNDED_COUNT_CAP
  }

  private dailyAmountCap(paymentService: PaymentServiceInstance): number {
    return this.normalizeAmountCap(paymentService.MAX_TOTAL_AMOUNT_PER_DAY)
  }

  private dailyCountCap(paymentService: PaymentServiceInstance): number {
    return this.normalizeCountCap(paymentService.MAX_USER_TRANSACTIONS_PER_DAY)
  }

  private monthlyAmountCap(paymentService: PaymentServiceInstance): number {
    return this.normalizeAmountCap(paymentService.MAX_TOTAL_AMOUNT_PER_DAY * this.monthlyMultiplier())
  }

  private monthlyCountCap(paymentService: PaymentServiceInstance): number {
    return this.normalizeCountCap(paymentService.MAX_USER_TRANSACTIONS_PER_DAY * this.monthlyMultiplier())
  }

  private monthlyMultiplier(): number {
    const raw = process.env.MONTHLY_LIMIT_MULTIPLIER_DAYS
    if (!raw) return 31
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 31
    }
    // Guard against extreme multipliers while preserving configuration flexibility.
    return Math.min(parsed, 62)
  }

  private interactiveTransactionMaxWaitMs(): number {
    return this.readBoundedIntEnv('TRANSACTION_ACCEPTANCE_TX_MAX_WAIT_MS', 5_000, 1_000, 30_000)
  }

  private interactiveTransactionTimeoutMs(): number {
    return this.readBoundedIntEnv('TRANSACTION_ACCEPTANCE_TX_TIMEOUT_MS', 15_000, 5_000, 60_000)
  }

  private readBoundedIntEnv(key: string, fallback: number, min: number, max: number): number {
    const raw = process.env[key]
    if (!raw) return fallback

    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) {
      return fallback
    }

    return Math.min(Math.max(parsed, min), max)
  }

  private normalizeCountry(country: string): KycCountry {
    const upper = country.toUpperCase()
    if (upper === 'CO') {
      return 'CO'
    }
    throw new TransactionValidationError(`KYC verification is not available for ${country}. Please provide a supported country or contact support.`)
  }

  private async publishUserNotification(
    prismaClient: PrismaClientLike,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    try {
      const full = await prismaClient.transaction.findUnique({
        include: {
          partnerUser: { include: { partner: true } },
          quote: true,
        },
        where: { id: transactionId },
      })

      await this.outboxDispatcher.enqueueQueue(QueueName.USER_NOTIFICATION, {
        payload: JSON.stringify(full ? toWebhookTransactionPayload(full) : { id: transactionId }),
        type: 'transaction.created',
        userId,
      }, 'transaction.created', { client: prismaClient, deliverNow: false })
    }
    catch (notifyErr) {
      this.logger.warn('Failed to publish transaction.created notification', notifyErr)
    }
  }

  private async reservePartnerDailyLimits(
    prismaClient: SerializableTx,
    partnerId: string,
    paymentMethod: PaymentMethod,
    targetAmount: number,
    paymentService: PaymentServiceInstance,
  ): Promise<void> {
    const day = this.startOfDay()
    const updated = await prismaClient.$executeRaw`
      INSERT INTO "PartnerDailyLimit" ("id", "partnerId", "paymentMethod", "day", "amount", "count")
      VALUES (gen_random_uuid(), ${partnerId}, ${paymentMethod}::"PaymentMethod", ${day}, ${targetAmount}, 1)
      ON CONFLICT ("partnerId", "paymentMethod", "day")
      DO UPDATE SET
        "amount" = "PartnerDailyLimit"."amount" + ${targetAmount},
        "count" = "PartnerDailyLimit"."count" + 1
      WHERE
        "PartnerDailyLimit"."amount" + ${targetAmount} <= ${this.dailyAmountCap(paymentService)}
        AND "PartnerDailyLimit"."count" + 1 <= ${this.dailyCountCap(paymentService)}
    `

    if (Number(updated) === 0) {
      throw new TransactionValidationError('This payment method reached today\'s partner limit. Please try again tomorrow or use another method.')
    }
  }

  private async reservePartnerMonthlyLimits(
    prismaClient: SerializableTx,
    partnerId: string,
    paymentMethod: PaymentMethod,
    targetAmount: number,
    paymentService: PaymentServiceInstance,
  ): Promise<void> {
    const month = this.startOfMonth()
    const updated = await prismaClient.$executeRaw`
      INSERT INTO "PartnerMonthlyLimit" ("id", "partnerId", "paymentMethod", "month", "amount", "count")
      VALUES (gen_random_uuid(), ${partnerId}, ${paymentMethod}::"PaymentMethod", ${month}, ${targetAmount}, 1)
      ON CONFLICT ("partnerId", "paymentMethod", "month")
      DO UPDATE SET
        "amount" = "PartnerMonthlyLimit"."amount" + ${targetAmount},
        "count" = "PartnerMonthlyLimit"."count" + 1
      WHERE
        "PartnerMonthlyLimit"."amount" + ${targetAmount} <= ${this.monthlyAmountCap(paymentService)}
        AND "PartnerMonthlyLimit"."count" + 1 <= ${this.monthlyCountCap(paymentService)}
    `

    if (Number(updated) === 0) {
      throw new TransactionValidationError('This payment method reached this month\'s partner limit. Please try again next month or use another method.')
    }
  }

  private async reserveUserDailyLimits(
    prismaClient: SerializableTx,
    partnerUserId: string,
    paymentMethod: PaymentMethod,
    targetAmount: number,
    paymentService: PaymentServiceInstance,
  ): Promise<void> {
    const day = this.startOfDay()
    const updated = await prismaClient.$executeRaw`
      INSERT INTO "PartnerUserDailyLimit" ("id", "partnerUserId", "paymentMethod", "day", "amount", "count")
      VALUES (gen_random_uuid(), ${partnerUserId}, ${paymentMethod}::"PaymentMethod", ${day}, ${targetAmount}, 1)
      ON CONFLICT ("partnerUserId", "paymentMethod", "day")
      DO UPDATE SET
        "amount" = "PartnerUserDailyLimit"."amount" + ${targetAmount},
        "count" = "PartnerUserDailyLimit"."count" + 1
      WHERE
        "PartnerUserDailyLimit"."amount" + ${targetAmount} <= ${this.dailyAmountCap(paymentService)}
        AND "PartnerUserDailyLimit"."count" + 1 <= ${this.dailyCountCap(paymentService)}
    `

    if (Number(updated) === 0) {
      throw new TransactionValidationError('You reached today\'s limit for this payment method. Try again tomorrow or choose another method.')
    }
  }

  private async reserveUserMonthlyLimits(
    prismaClient: SerializableTx,
    partnerUserId: string,
    paymentMethod: PaymentMethod,
    targetAmount: number,
    paymentService: PaymentServiceInstance,
  ): Promise<void> {
    const month = this.startOfMonth()
    const updated = await prismaClient.$executeRaw`
      INSERT INTO "PartnerUserMonthlyLimit" ("id", "partnerUserId", "paymentMethod", "month", "amount", "count")
      VALUES (gen_random_uuid(), ${partnerUserId}, ${paymentMethod}::"PaymentMethod", ${month}, ${targetAmount}, 1)
      ON CONFLICT ("partnerUserId", "paymentMethod", "month")
      DO UPDATE SET
        "amount" = "PartnerUserMonthlyLimit"."amount" + ${targetAmount},
        "count" = "PartnerUserMonthlyLimit"."count" + 1
      WHERE
        "PartnerUserMonthlyLimit"."amount" + ${targetAmount} <= ${this.monthlyAmountCap(paymentService)}
        AND "PartnerUserMonthlyLimit"."count" + 1 <= ${this.monthlyCountCap(paymentService)}
    `

    if (Number(updated) === 0) {
      throw new TransactionValidationError('You reached this month\'s limit for this payment method. Try again next month or choose another method.')
    }
  }

  private async resolveKycLinkAfterDecision(
    totalUserAmountMonthly: number,
    country: string,
    redirectUrl: string | undefined,
    partnerUserId: string,
  ): Promise<string> {
    const normalizedCountry = this.normalizeCountry(country)
    const kycLink = await this.kycService.getKycLink({
      amount: totalUserAmountMonthly,
      country: normalizedCountry,
      redirectUrl,
      userId: partnerUserId,
    })

    if (!kycLink) {
      throw new TransactionValidationError('We could not start the verification process right now. Please try again in a few moments.')
    }

    return kycLink
  }

  private async shouldRequestKyc(
    prismaClient: SerializableTx,
    partner: PartnerUserContext,
    partnerUserId: string,
    totalUserAmountMonthly: number,
    country: string,
  ): Promise<boolean> {
    if (!partner.needsKyc) {
      return false
    }

    if (isKycExemptByAmount(totalUserAmountMonthly)) {
      return false
    }

    const normalizedCountry = this.normalizeCountry(country)
    const approvedTier = await this.fetchApprovedKycTier(prismaClient, partnerUserId)
    const nextTier = getNextTier(normalizedCountry, totalUserAmountMonthly, approvedTier)
    return nextTier !== null
  }

  private startOfDay(): Date {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return now
  }

  private startOfMonth(): Date {
    const now = new Date()
    now.setDate(1)
    now.setHours(0, 0, 0, 0)
    return now
  }
}

export class TransactionValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason)
  }
}
