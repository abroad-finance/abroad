import { Country, PaymentMethod, TransactionStatus } from '@prisma/client'

import { isKycExemptByAmount } from '../config/kyc'
import { IQueueHandler, QueueName } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IKycService } from '../interfaces/IKycService'
import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { IWebhookNotifier, WebhookEvent } from '../interfaces/IWebhookNotifier'
import { uuidToBase64 } from './transactionEncoding'

interface AcceptTransactionRequest {
  accountNumber: string
  bankCode: string
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

export class TransactionAcceptanceService {
  constructor(
    private readonly prismaClientProvider: IDatabaseClientProvider,
    private readonly paymentServiceFactory: IPaymentServiceFactory,
    private readonly kycService: IKycService,
    private readonly webhookNotifier: IWebhookNotifier,
    private readonly queueHandler: IQueueHandler,
  ) {}

  public async acceptTransaction(
    request: AcceptTransactionRequest,
    partner: PartnerUserContext,
  ): Promise<AcceptTransactionResponse> {
    const prismaClient = await this.prismaClientProvider.getClient()
    const quote = await this.fetchQuote(prismaClient, request.quoteId, partner.id)
    const paymentService = this.paymentServiceFactory.getPaymentService(quote.paymentMethod)
    this.assertPaymentServiceIsEnabled(paymentService, quote.paymentMethod)

    await this.ensureAccountIsValid(paymentService, request.accountNumber, request.bankCode)

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
      paymentService,
      qrCode: request.qrCode,
      quoteId: quote.id,
      taxId: request.taxId,
      userId: request.userId,
    })
  }

  private assertPaymentServiceIsEnabled(paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>, paymentMethod: PaymentMethod): void {
    if (!paymentService.isEnabled) {
      throw new TransactionValidationError(`Payment method ${paymentMethod} is currently unavailable`)
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
      bankCode: string
      partner: PartnerUserContext
      partnerUserId: string
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
          bankCode: input.bankCode,
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
      console.warn('Error creating transaction:', error)
      throw new TransactionValidationError('Transaction creation failed')
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
      console.warn('Failed to fetch payment service liquidity', err)
      availableLiquidity = 0
    }

    if (targetAmount > availableLiquidity) {
      throw new TransactionValidationError('This payment method does not have enough liquidity for the requested amount')
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
      throw new TransactionValidationError('Partner KYB not approved. Maximum total amount of $100 allowed.')
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
      throw new TransactionValidationError('This payment method has reached the maximum amount for today')
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
      throw new TransactionValidationError('User has reached the maximum number of transactions for today')
    }

    const totalUserAmount = userTransactionsToday.reduce((acc, transaction) => acc + transaction.quote.targetAmount, 0)

    if (totalUserAmount + quote.targetAmount > paymentService.MAX_TOTAL_AMOUNT_PER_DAY) {
      throw new TransactionValidationError('User has reached the maximum amount for today')
    }
  }

  private async ensureAccountIsValid(paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>, accountNumber: string, bankCode: string) {
    const isAccountValid = await paymentService.verifyAccount({ account: accountNumber, bankCode })
    if (!isAccountValid) {
      throw new TransactionValidationError('User account is invalid.')
    }
  }

  private async fetchQuote(prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>, quoteId: string, partnerId: string) {
    const quote = await prismaClient.quote.findUnique({
      where: { id: quoteId, partnerId },
    })

    if (!quote) {
      throw new TransactionValidationError('Quote not found')
    }

    return quote
  }

  private normalizeCountry(country: string): Country {
    const upper = country.toUpperCase()
    if (upper === Country.CO) {
      return Country.CO
    }
    throw new TransactionValidationError(`Unsupported country for KYC: ${country}`)
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
      console.warn('[TransactionAcceptanceService] Failed to publish transaction.created notification', notifyErr)
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
