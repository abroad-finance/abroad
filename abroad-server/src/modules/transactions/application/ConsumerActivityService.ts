import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  CustomerFeeType,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const refundRelevantStatuses: ReadonlySet<TransactionStatus> = new Set([
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.WRONG_AMOUNT,
])
const transactionIdSchema = z.string().uuid()

const activityInclude = {
  economics: {
    select: {
      lastReconciledAt: true,
      lockedRateNativePerUsd: true,
    },
  },
  quote: true,
  transitions: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.TransactionInclude

export type ConsumerActivityFeeDto = {
  amount: string
  currency: string
  type: 'COMBINED' | 'FIXED' | 'NETWORK' | 'NONE' | 'PERCENTAGE'
}

export type ConsumerActivityFilters = {
  createdFrom?: string
  createdTo?: string
  network?: BlockchainNetwork
  page?: number
  pageSize?: number
  paymentMethod?: PaymentMethod
  sort?: ConsumerActivitySort
  status?: TransactionStatus
  targetCurrency?: TargetCurrency
}

export type ConsumerActivityLifecycleDto = {
  occurredAt: Date
  status: TransactionStatus
  type: 'CREATED' | 'STATUS_CHANGED'
}

export type ConsumerActivityListResponse = {
  items: ConsumerActivityTransactionDto[]
  page: number
  pageSize: number
  total: number
}

export type ConsumerActivityProofDto = {
  receiptAvailable: boolean
  status: 'AVAILABLE' | 'MISSING' | 'NOT_APPLICABLE' | 'PENDING'
}

export type ConsumerActivityQuoteDto = {
  country: Country
  network: BlockchainNetwork
  paymentMethod: PaymentMethod
  sourceAmount: number
  sourceCurrency: CryptoCurrency
  targetAmount: number
  targetCurrency: TargetCurrency
}

export type ConsumerActivityReceiptDto = ConsumerActivityTransactionDto & {
  effectiveRate: null | string
  fee: ConsumerActivityFeeDto | null
  lifecycle: ConsumerActivityLifecycleDto[]
  references: ConsumerActivityReferencesDto
}

export type ConsumerActivityReferencesDto = {
  abroadId: string
  brebId: null | string
  onChainId: null | string
  pixEndToEndId: null | string
  providerId: null | string
  refundOnChainId: null | string
}

export type ConsumerActivityRefundDto = {
  reference: null | string
  status: 'COMPLETED' | 'FAILED' | 'NOT_APPLICABLE' | 'NOT_STARTED' | 'PROCESSING' | 'UNKNOWN'
}

export type ConsumerActivitySort = 'newest' | 'oldest'

export type ConsumerActivityTimestampsDto = {
  acceptedAt: Date
  completedAt: Date | null
  createdAt: Date
  lastReconciledAt: Date | null
  payoutSubmittedAt: Date | null
  updatedAt: Date
}

export type ConsumerActivityTransactionDto = {
  id: string
  proof: ConsumerActivityProofDto
  quote: ConsumerActivityQuoteDto
  recipientHint: null | string
  refund: ConsumerActivityRefundDto
  status: TransactionStatus
  timestamps: ConsumerActivityTimestampsDto
}

export interface IConsumerActivityService {
  getById(
    partnerId: string,
    authenticatedSubject: string,
    transactionId: string,
  ): Promise<ConsumerActivityReceiptDto>
  list(
    partnerId: string,
    authenticatedSubject: string,
    filters: ConsumerActivityFilters,
  ): Promise<ConsumerActivityListResponse>
}

type ActivityRow = Prisma.TransactionGetPayload<{ include: typeof activityInclude }>

type NormalizedFilters = {
  createdFrom?: Date
  createdTo?: Date
  network?: BlockchainNetwork
  page: number
  pageSize: number
  paymentMethod?: PaymentMethod
  sort: ConsumerActivitySort
  status?: TransactionStatus
  targetCurrency?: TargetCurrency
}

export class ConsumerActivityNotFoundError extends Error {
  public constructor() {
    super('Activity transaction not found')
    this.name = 'ConsumerActivityNotFoundError'
  }
}

export class ConsumerActivityValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ConsumerActivityValidationError'
  }
}

@injectable()
export class ConsumerActivityService implements IConsumerActivityService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async getById(
    partnerId: string,
    authenticatedSubject: string,
    transactionId: string,
  ): Promise<ConsumerActivityReceiptDto> {
    if (!transactionIdSchema.safeParse(transactionId).success) {
      throw new ConsumerActivityValidationError('Transaction ID must be a UUID')
    }

    const prismaClient = await this.databaseClientProvider.getClient()
    const transaction = await prismaClient.transaction.findFirst({
      include: activityInclude,
      where: {
        id: transactionId,
        partnerUser: { partnerId, userId: authenticatedSubject },
      },
    })
    if (!transaction) {
      throw new ConsumerActivityNotFoundError()
    }

    return this.toReceipt(transaction)
  }

  public async list(
    partnerId: string,
    authenticatedSubject: string,
    filters: ConsumerActivityFilters,
  ): Promise<ConsumerActivityListResponse> {
    const normalizedFilters = this.normalizeFilters(filters)
    const where = this.buildWhere(partnerId, authenticatedSubject, normalizedFilters)
    const sortDirection = normalizedFilters.sort === 'oldest' ? 'asc' : 'desc'
    const prismaClient = await this.databaseClientProvider.getClient()
    const [transactions, total] = await Promise.all([
      prismaClient.transaction.findMany({
        include: activityInclude,
        orderBy: [{ createdAt: sortDirection }, { id: sortDirection }],
        skip: (normalizedFilters.page - 1) * normalizedFilters.pageSize,
        take: normalizedFilters.pageSize,
        where,
      }),
      prismaClient.transaction.count({ where }),
    ])

    return {
      items: transactions.map(transaction => this.toTransaction(transaction)),
      page: normalizedFilters.page,
      pageSize: normalizedFilters.pageSize,
      total,
    }
  }

  private buildWhere(
    partnerId: string,
    authenticatedSubject: string,
    filters: NormalizedFilters,
  ): Prisma.TransactionWhereInput {
    const quoteFilter = {
      ...(filters.network ? { network: filters.network } : {}),
      ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
      ...(filters.targetCurrency ? { targetCurrency: filters.targetCurrency } : {}),
    }
    return {
      ...(filters.createdFrom || filters.createdTo
        ? {
            createdAt: {
              ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
              ...(filters.createdTo ? { lt: filters.createdTo } : {}),
            },
          }
        : {}),
      partnerUser: { partnerId, userId: authenticatedSubject },
      ...(Object.keys(quoteFilter).length > 0 ? { quote: quoteFilter } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    }
  }

  private isJsonObject(value: Prisma.JsonValue | undefined): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private maskDestination(accountNumber: string): null | string {
    const normalized = accountNumber.trim()
    if (!normalized) {
      return null
    }
    return normalized.length <= 4 ? '••••' : `•••• ${normalized.slice(-4)}`
  }

  private normalizeFilters(filters: ConsumerActivityFilters): NormalizedFilters {
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
    const sort = filters.sort ?? 'newest'
    if (!Number.isInteger(page) || page < 1) {
      throw new ConsumerActivityValidationError('Page must be a positive integer')
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new ConsumerActivityValidationError(`Page size must be between 1 and ${MAX_PAGE_SIZE}`)
    }
    if (sort !== 'newest' && sort !== 'oldest') {
      throw new ConsumerActivityValidationError('Sort must be newest or oldest')
    }

    const createdFrom = this.parseCalendarDate(filters.createdFrom, false)
    const createdTo = this.parseCalendarDate(filters.createdTo, true)
    if (createdFrom && createdTo && createdFrom >= createdTo) {
      throw new ConsumerActivityValidationError('Start date must be on or before end date')
    }

    return {
      ...filters,
      createdFrom,
      createdTo,
      page,
      pageSize,
      sort,
    }
  }

  private parseCalendarDate(value: string | undefined, endExclusive: boolean): Date | undefined {
    if (!value) {
      return undefined
    }
    const match = ISO_DATE_PATTERN.exec(value)
    if (!match) {
      throw new ConsumerActivityValidationError('Dates must use YYYY-MM-DD format')
    }

    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      throw new ConsumerActivityValidationError('Date is not a valid calendar day')
    }
    if (endExclusive) {
      date.setUTCDate(date.getUTCDate() + 1)
    }
    return date
  }

  private readRefundContextStatus(
    context: Prisma.JsonValue | undefined,
  ): 'failed' | 'pending' | 'succeeded' | undefined {
    if (!this.isJsonObject(context)) {
      return undefined
    }
    const status = context.status
    return status === 'failed' || status === 'pending' || status === 'succeeded'
      ? status
      : undefined
  }

  private toCustomerFee(transaction: ActivityRow): ConsumerActivityFeeDto | null {
    const {
      customerFeeSourceAmount,
      customerFeeSourceCurrency,
      customerFeeType,
    } = transaction.quote
    if (
      customerFeeSourceAmount === null
      || customerFeeSourceCurrency === null
      || customerFeeType === null
    ) {
      return null
    }

    const type = customerFeeType === CustomerFeeType.COMBINED
      ? 'COMBINED'
      : customerFeeType === CustomerFeeType.FIXED
        ? 'FIXED'
        : customerFeeType === CustomerFeeType.PERCENTAGE
          ? 'PERCENTAGE'
          : 'NONE'
    return {
      amount: customerFeeSourceAmount.toFixed(),
      currency: customerFeeSourceCurrency,
      type,
    }
  }

  private toEffectiveRate(transaction: ActivityRow): null | string {
    if (transaction.economics?.lockedRateNativePerUsd) {
      return transaction.economics.lockedRateNativePerUsd.toString()
    }
    if (transaction.quote.sourceAmount <= 0) {
      return null
    }
    return new Prisma.Decimal(String(transaction.quote.targetAmount))
      .dividedBy(new Prisma.Decimal(String(transaction.quote.sourceAmount)))
      .toString()
  }

  private toLifecycle(transaction: ActivityRow): ConsumerActivityLifecycleDto[] {
    const initialStatus = transaction.transitions[0]?.fromStatus ?? transaction.status
    return [
      {
        occurredAt: transaction.createdAt,
        status: initialStatus,
        type: 'CREATED',
      },
      ...transaction.transitions.map(transition => ({
        occurredAt: transition.createdAt,
        status: transition.toStatus,
        type: 'STATUS_CHANGED' as const,
      })),
    ]
  }

  private toProof(transaction: ActivityRow): ConsumerActivityProofDto {
    if (transaction.quote.paymentMethod !== PaymentMethod.PIX) {
      return { receiptAvailable: false, status: 'NOT_APPLICABLE' }
    }
    const receiptAvailable = (
      transaction.status === TransactionStatus.PAYMENT_COMPLETED
      && Boolean(transaction.externalId)
    )
    if (transaction.pixEndToEndId) {
      return { receiptAvailable, status: 'AVAILABLE' }
    }
    if (transaction.status === TransactionStatus.PAYMENT_COMPLETED) {
      return { receiptAvailable, status: 'MISSING' }
    }
    return { receiptAvailable, status: 'PENDING' }
  }

  private toQuote(transaction: ActivityRow): ConsumerActivityQuoteDto {
    return {
      country: transaction.quote.country,
      network: transaction.quote.network,
      paymentMethod: transaction.quote.paymentMethod,
      sourceAmount: transaction.quote.sourceAmount,
      sourceCurrency: transaction.quote.cryptoCurrency,
      targetAmount: transaction.quote.targetAmount,
      targetCurrency: transaction.quote.targetCurrency,
    }
  }

  private toReceipt(transaction: ActivityRow): ConsumerActivityReceiptDto {
    return {
      ...this.toTransaction(transaction),
      effectiveRate: this.toEffectiveRate(transaction),
      fee: this.toCustomerFee(transaction),
      lifecycle: this.toLifecycle(transaction),
      references: {
        abroadId: transaction.id,
        brebId: null,
        onChainId: transaction.onChainId,
        pixEndToEndId: transaction.quote.paymentMethod === PaymentMethod.PIX
          ? transaction.pixEndToEndId
          : null,
        providerId: transaction.externalId,
        refundOnChainId: transaction.refundOnChainId,
      },
    }
  }

  private toRefund(transaction: ActivityRow): ConsumerActivityRefundDto {
    if (transaction.refundOnChainId) {
      return {
        reference: transaction.refundOnChainId,
        status: 'COMPLETED',
      }
    }
    const refundTransition = [...transaction.transitions]
      .reverse()
      .find(transition => transition.event === 'refund')
    if (!refundRelevantStatuses.has(transaction.status) && !refundTransition) {
      return { reference: null, status: 'NOT_APPLICABLE' }
    }
    const contextStatus = this.readRefundContextStatus(refundTransition?.context)
    if (contextStatus === 'succeeded') {
      // The canonical completed-refund identity is Transaction.refundOnChainId.
      // A successful transition without that assignment remains ambiguous and
      // must not be presented to a customer as a completed economic outcome.
      return { reference: null, status: 'UNKNOWN' }
    }
    if (contextStatus === 'pending') {
      return { reference: null, status: 'PROCESSING' }
    }
    if (contextStatus === 'failed') {
      return { reference: null, status: 'FAILED' }
    }
    return { reference: null, status: 'NOT_STARTED' }
  }

  private toTimestamps(transaction: ActivityRow): ConsumerActivityTimestampsDto {
    const completedTransition = transaction.transitions.find(
      transition => transition.toStatus === TransactionStatus.PAYMENT_COMPLETED,
    )
    const latestTransition = transaction.transitions[transaction.transitions.length - 1]
    return {
      acceptedAt: transaction.createdAt,
      completedAt: completedTransition?.createdAt ?? null,
      createdAt: transaction.createdAt,
      lastReconciledAt: transaction.economics?.lastReconciledAt ?? null,
      payoutSubmittedAt: transaction.exchangeHandoffAt,
      updatedAt: latestTransition?.createdAt ?? transaction.createdAt,
    }
  }

  private toTransaction(transaction: ActivityRow): ConsumerActivityTransactionDto {
    return {
      id: transaction.id,
      proof: this.toProof(transaction),
      quote: this.toQuote(transaction),
      recipientHint: this.maskDestination(transaction.accountNumber),
      refund: this.toRefund(transaction),
      status: transaction.status,
      timestamps: this.toTimestamps(transaction),
    }
  }
}
