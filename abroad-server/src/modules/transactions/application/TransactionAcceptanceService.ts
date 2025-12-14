import { Country, PaymentMethod, TargetCurrency, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { isKycExemptByAmount } from '../../../app/config/kyc'
import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IQueueHandler, QueueName } from '../../../platform/messaging/queues'
import { IWebhookNotifier, WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IKycService } from '../../kyc/application/contracts/IKycService'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { uuidToBase64 } from '../infrastructure/transactionEncoding'

interface AcceptTransactionRequest {
  accountNumber: string
  bankCode?: string
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

@injectable()
export class TransactionAcceptanceService {
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPaymentServiceFactory)
    private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IKycService) private readonly kycService: IKycService,
    @inject(TYPES.IWebhookNotifier) private readonly webhookNotifier: IWebhookNotifier,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) logger: ILogger,
  ) {
    this.logger = createScopedLogger(logger, { scope: 'TransactionAcceptance' })
  }

  public async acceptTransaction(
    request: AcceptTransactionRequest,
    partner: PartnerUserContext,
  ): Promise<AcceptTransactionResponse> {
    const prismaClient = await this.prismaClientProvider.getClient()
    const quote = await this.fetchQuote(prismaClient, request.quoteId, partner.id)
    const paymentService = this.paymentServiceFactory.getPaymentService(quote.paymentMethod)
    this.assertPaymentServiceIsEnabled(paymentService, quote.paymentMethod)

    this.enforceTransactionAmountBounds(quote, paymentService, quote.paymentMethod)
    await this.ensureAccountIsValid(paymentService, request.accountNumber, request.bankCode, quote.paymentMethod)

    const partnerUser = await prismaClient.partnerUser.upsert({
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

    const monthlyAmount = await this.calculateMonthlyAmount(prismaClient, partnerUser.id, quote.paymentMethod)
    const totalUserAmountMonthly = monthlyAmount + quote.sourceAmount
    const kycLink = await this.resolveKycLink(partner, totalUserAmountMonthly, quote.country, request.redirectUrl, partnerUser.id)
    if (kycLink) {
      return {
        id: null,
        kycLink,
        transactionReference: null,
      }
    }

    await this.enforceUserTransactionLimits(prismaClient, partnerUser.id, quote, paymentService)
    await this.enforcePaymentMethodLimits(prismaClient, quote, paymentService)
    await this.enforceLiquidity(paymentService, quote.targetAmount)
    await this.enforcePartnerKybThreshold(prismaClient, partner.id, quote.sourceAmount, partner.isKybApproved)

    return this.createTransaction(prismaClient, {
      accountNumber: request.accountNumber,
      bankCode: request.bankCode,
      partner,
      partnerUserId: partnerUser.id,
      paymentMethod: quote.paymentMethod,
      paymentService,
      qrCode: request.qrCode,
      quoteId: quote.id,
      taxId: request.taxId,
      userId: request.userId,
    })
  }

  private assertPaymentServiceIsEnabled(paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>, paymentMethod: PaymentMethod): void {
    if (!paymentService.isEnabled) {
      throw new TransactionValidationError(`Payments via ${paymentMethod} are temporarily unavailable. Please try another method or retry shortly.`)
    }
  }

  private async calculateMonthlyAmount(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
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

  private async createTransaction(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    input: {
      accountNumber: string
      bankCode?: string
      partner: PartnerUserContext
      partnerUserId: string
      paymentMethod: PaymentMethod
      paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>
      qrCode?: null | string
      quoteId: string
      taxId?: string
      userId: string
    },
  ): Promise<AcceptTransactionResponse> {
    try {
      const transaction = await prismaClient.transaction.create({
        data: {
          accountNumber: input.accountNumber,
          bankCode: input.bankCode ?? '',
          partnerUserId: input.partnerUserId,
          qrCode: input.qrCode,
          quoteId: input.quoteId,
          status: TransactionStatus.AWAITING_PAYMENT,
          taxId: input.taxId,
        },
      })
      await this.webhookNotifier.notifyWebhook(input.partner.webhookUrl, { data: transaction, event: WebhookEvent.TRANSACTION_CREATED })

      await this.publishUserNotification(prismaClient, transaction.id, input.userId)

      return {
        id: transaction.id,
        kycLink: null,
        transactionReference: uuidToBase64(transaction.id),
      }
    }
    catch (error) {
      this.logger.error('Error creating transaction', error)
      throw new TransactionValidationError('We could not create your transaction right now. Please try again in a few moments.')
    }
  }

  private async enforceLiquidity(
    paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>,
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
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    partnerId: string,
    sourceAmount: number,
    isKybApproved: boolean,
  ) {
    if (isKybApproved) {
      return
    }

    const partnerTransactions = await prismaClient.transaction.findMany({
      include: { partnerUser: true, quote: true },
      where: {
        partnerUser: { partnerId },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })
    const partnerTotalAmount = partnerTransactions.reduce((sum, tx) => sum + tx.quote.sourceAmount, 0)
    if (partnerTotalAmount + sourceAmount > 100) {
      throw new TransactionValidationError('This partner is limited to a total of $100 until KYB is approved. Please complete KYB to raise the limit.')
    }
  }

  private async enforcePaymentMethodLimits(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    quote: { paymentMethod: PaymentMethod, targetAmount: number },
    paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>,
  ) {
    const transactionsToday = await prismaClient.transaction.findMany({
      include: { quote: true },
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
        quote: {
          paymentMethod: quote.paymentMethod,
        },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })

    const totalAmountToday = transactionsToday.reduce((acc, transaction) => acc + transaction.quote.targetAmount, 0)

    if (totalAmountToday + quote.targetAmount > paymentService.MAX_TOTAL_AMOUNT_PER_DAY) {
      throw new TransactionValidationError('This payment method already reached today\'s payout limit. Please try again tomorrow or use another method.')
    }
  }

  private enforceTransactionAmountBounds(
    quote: { targetAmount: number, targetCurrency: TargetCurrency },
    paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>,
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
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    partnerUserId: string,
    quote: { paymentMethod: PaymentMethod, targetAmount: number },
    paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>,
  ) {
    const userTransactionsToday = await prismaClient.transaction.findMany({
      include: { quote: true },
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
        partnerUserId,
        quote: {
          paymentMethod: quote.paymentMethod,
        },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })

    if (userTransactionsToday.length >= paymentService.MAX_USER_TRANSACTIONS_PER_DAY) {
      throw new TransactionValidationError('You reached the maximum number of transactions allowed today. Please try again tomorrow.')
    }

    const totalUserAmount = userTransactionsToday.reduce((acc, transaction) => acc + transaction.quote.targetAmount, 0)

    if (totalUserAmount + quote.targetAmount > paymentService.MAX_TOTAL_AMOUNT_PER_DAY) {
      throw new TransactionValidationError('This transaction would exceed your daily limit for this payment method. Lower the amount or try again tomorrow.')
    }
  }

  private async ensureAccountIsValid(
    paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>,
    accountNumber: string,
    bankCode: string | undefined,
    paymentMethod: PaymentMethod,
  ) {
    if (paymentMethod === PaymentMethod.MOVII && !bankCode) {
      throw new TransactionValidationError('A bank code is required to process MOVII payments. Please add the bank code and try again.')
    }

    const isAccountValid = await paymentService.verifyAccount({ account: accountNumber, bankCode: bankCode ?? '' })
    if (!isAccountValid) {
      throw new TransactionValidationError('We could not verify the account number and bank code provided. Please double-check the details and try again.')
    }
  }

  private async fetchQuote(prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>, quoteId: string, partnerId: string) {
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

      await this.queueHandler.postMessage(QueueName.USER_NOTIFICATION, {
        payload: JSON.stringify(full ?? { id: transactionId }),
        type: 'transaction.created',
        userId,
      })
    }
    catch (notifyErr) {
      this.logger.warn('Failed to publish transaction.created notification', notifyErr)
    }
  }

  private async resolveKycLink(
    partner: PartnerUserContext,
    totalUserAmountMonthly: number,
    country: string,
    redirectUrl: string | undefined,
    partnerUserId: string,
  ): Promise<null | string> {
    const shouldRequestKyc = partner.needsKyc && !isKycExemptByAmount(totalUserAmountMonthly)
    if (!shouldRequestKyc) {
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
}

export class TransactionValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason)
  }
}
