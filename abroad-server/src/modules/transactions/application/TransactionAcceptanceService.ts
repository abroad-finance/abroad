import {
  Country,
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

type PartnerUserContext = {
  id: string
  isKybApproved: boolean
  needsKyc: boolean
  webhookUrl: string
}

type PaymentServiceInstance = ReturnType<IPaymentServiceFactory['getPaymentService']>
type SerializableTx = Prisma.TransactionClient

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
    const decision = await prismaClient.$transaction(async (tx) => {
      const quote = await this.fetchQuote(tx, request.quoteId, partner.id)
      const paymentService = this.paymentServiceFactory.getPaymentServiceForCapability({
        paymentMethod: quote.paymentMethod,
        targetCurrency: quote.targetCurrency,
      })
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
      const shouldRequestKyc = this.shouldRequestKyc(partner, totalUserAmountMonthly)
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

      return {
        outcome: 'transaction',
        partnerUserId: partnerUser.id,
        quoteId: quote.id,
        transaction,
      } as const
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (decision.outcome === 'kyc') {
      const kycLink = await this.resolveKycLinkAfterDecision(
        partner,
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

    try {
      const transactionReference = uuidToBase64(decision.transaction.id)
      const payload = toWebhookTransactionPayload(decision.transaction)

      await this.outboxDispatcher.enqueueWebhook(
        partner.webhookUrl,
        { data: payload, event: WebhookEvent.TRANSACTION_CREATED },
        'transaction.created',
        { client: prismaClient, deliverNow: false },
      )

      await this.publishUserNotification(prismaClient, decision.transaction.id, request.userId)

      return {
        id: decision.transaction.id,
        kycLink: null,
        transactionReference,
      }
    }
    catch (error) {
      this.logger.error('Error creating transaction', error)
      throw new TransactionValidationError('We could not create your transaction right now. Please try again in a few moments.')
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
    const userTransactionsMonthly = await prismaClient.transaction.findMany({
      include: { quote: true },
      where: {
        createdAt: {
          gte: new Date(new Date().setDate(new Date().getDate() - 30)),
        },
        partnerUserId,
        quote: {
          paymentMethod,
        },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })

    return userTransactionsMonthly.reduce((acc, transaction) => acc + transaction.quote.sourceAmount, 0)
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

    const aggregate = await prismaClient.transaction.aggregate({
      _sum: { sourceAmount: true },
      where: {
        partnerUser: { partnerId },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })
    const partnerTotalAmount = aggregate._sum.sourceAmount ?? 0
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
    const aggregate = await prismaClient.transaction.aggregate({
      _sum: { targetAmount: true },
      where: {
        createdAt: { gte: todayStart },
        quote: { paymentMethod: quote.paymentMethod },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })
    const totalAmountToday = aggregate._sum.targetAmount ?? 0
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
    const aggregate = await prismaClient.transaction.aggregate({
      _count: { id: true },
      _sum: { targetAmount: true },
      where: {
        createdAt: { gte: todayStart },
        partnerUserId,
        quote: { paymentMethod: quote.paymentMethod },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })

    const count = aggregate._count.id ?? 0
    if (count >= paymentService.MAX_USER_TRANSACTIONS_PER_DAY) {
      throw new TransactionValidationError('You reached the maximum number of transactions allowed today. Please try again tomorrow.')
    }

    const totalUserAmount = aggregate._sum.targetAmount ?? 0
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

  private async fetchQuote(prismaClient: SerializableTx, quoteId: string, partnerId: string) {
    const quote = await prismaClient.quote.findUnique({
      where: { id: quoteId, partnerId },
    })

    if (!quote) {
      throw new TransactionValidationError('We could not find a valid quote for this request. Please generate a new quote and try again.')
    }

    return quote
  }

  private normalizeCountry(country: string): Country {
    const upper = country.toUpperCase()
    if (upper === Country.CO) {
      return Country.CO
    }
    throw new TransactionValidationError(`KYC verification is not available for ${country}. Please provide a supported country or contact support.`)
  }

  private async lockPartner(
    prismaClient: SerializableTx,
    partnerId: string,
  ): Promise<void> {
    // Coarse lock to serialize partner-level aggregate checks.
    await prismaClient.$executeRaw`SELECT 1 FROM "Partner" WHERE id = ${partnerId} FOR UPDATE`
  }

  private async lockPaymentMethod(
    prismaClient: SerializableTx,
    paymentMethod: PaymentMethod,
  ): Promise<void> {
    // Prevent concurrent acceptances from racing on method-level daily totals.
    await prismaClient.$executeRaw`SELECT 1 FROM "PaymentProvider" WHERE id = ${paymentMethod} FOR UPDATE`
  }

  private async lockPartnerUser(
    prismaClient: SerializableTx,
    partnerUserId: string,
  ): Promise<void> {
    // Serialize concurrent accept attempts for the same partner user to prevent limit races.
    await prismaClient.$executeRaw`SELECT 1 FROM "PartnerUser" WHERE id = ${partnerUserId} FOR UPDATE`
  }

  private async publishUserNotification(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    transactionId: string,
    userId: string,
  ) {
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

  private async resolveKycLinkAfterDecision(
    partner: PartnerUserContext,
    totalUserAmountMonthly: number,
    country: string,
    redirectUrl: string | undefined,
    partnerUserId: string,
  ): Promise<null | string> {
    if (!this.shouldRequestKyc(partner, totalUserAmountMonthly)) {
      return null
    }

    const normalizedCountry = this.normalizeCountry(country)
    return this.kycService.getKycLink({
      amount: totalUserAmountMonthly,
      country: normalizedCountry,
      redirectUrl,
      userId: partnerUserId,
    })
  }

  private shouldRequestKyc(partner: PartnerUserContext, totalUserAmountMonthly: number): boolean {
    return partner.needsKyc && !isKycExemptByAmount(totalUserAmountMonthly)
  }
}

export class TransactionValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason)
  }
}
