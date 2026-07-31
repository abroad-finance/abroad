import { OutboxStatus, Prisma, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_QUERY_LENGTH = 200
const MAX_EXPORT_ROWS = 5_000
const MAX_DELIVERY_ROWS = 20
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const FORMULA_PREFIX_PATTERN = /^[\t\r\n ]*[=+\-@]/

const transactionStatuses = [
  TransactionStatus.AWAITING_PAYMENT,
  TransactionStatus.PROCESSING_PAYMENT,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_COMPLETED,
  TransactionStatus.WRONG_AMOUNT,
] as const

const summaryInclude = {
  partnerUser: { select: { userId: true } },
  quote: true,
} satisfies Prisma.TransactionInclude

const detailInclude = {
  ...summaryInclude,
  transitions: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.TransactionInclude

export type PartnerTransactionDeliveryDto = {
  attempts: number
  event: 'unknown' | WebhookEvent
  lastAttemptAt: Date
  status: OutboxStatus
}
export type PartnerTransactionDetailDto = PartnerTransactionSummaryDto & {
  deliveries: PartnerTransactionDeliveryDto[]
  lifecycle: PartnerTransactionLifecycleDto[]
  payoutDestinationHint: null | string
}

export type PartnerTransactionExport = {
  csv: string
  rowCount: number
  truncated: boolean
}

export type PartnerTransactionLifecycleDto = {
  occurredAt: Date
  status: TransactionStatus
  type: 'CREATED' | 'STATUS_CHANGED'
}

export type PartnerTransactionListResponse = {
  items: PartnerTransactionSummaryDto[]
  page: number
  pageSize: number
  statusCounts: PartnerTransactionStatusCountDto[]
  total: number
}

export type PartnerTransactionQuoteDto = {
  country: string
  cryptoCurrency: string
  network: string
  paymentMethod: string
  sourceAmount: number
  targetAmount: number
  targetCurrency: string
}

export type PartnerTransactionSearchFilters = {
  createdFrom?: string
  createdTo?: string
  page?: number
  pageSize?: number
  query?: string
  status?: TransactionStatus
}

export type PartnerTransactionStatusCountDto = {
  count: number
  status: TransactionStatus
}

export type PartnerTransactionSummaryDto = {
  createdAt: Date
  id: string
  onChainId: null | string
  quote: PartnerTransactionQuoteDto
  status: TransactionStatus
  userReference: string
}

type DetailRow = Prisma.TransactionGetPayload<{ include: typeof detailInclude }>

type NormalizedFilters = {
  createdFrom?: Date
  createdTo?: Date
  page: number
  pageSize: number
  query?: string
  status?: TransactionStatus
}

type SummaryRow = Prisma.TransactionGetPayload<{ include: typeof summaryInclude }>

export class PartnerTransactionNotFoundError extends Error {
  public constructor() {
    super('Transaction not found')
    this.name = 'PartnerTransactionNotFoundError'
  }
}

@injectable()
export class PartnerTransactionQueryService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async exportCsv(
    partnerId: string,
    filters: PartnerTransactionSearchFilters,
  ): Promise<PartnerTransactionExport> {
    const normalizedFilters = this.normalizeFilters(filters)
    const prismaClient = await this.databaseClientProvider.getClient()
    const rows = await prismaClient.transaction.findMany({
      include: summaryInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_EXPORT_ROWS + 1,
      where: this.buildWhere(partnerId, normalizedFilters, true),
    })
    const exportedRows = rows.slice(0, MAX_EXPORT_ROWS)
    const csvRows = [
      [
        'created_at',
        'transaction_id',
        'status',
        'user_reference',
        'source_amount',
        'source_currency',
        'target_amount',
        'target_currency',
        'network',
        'payment_method',
        'on_chain_id',
      ],
      ...exportedRows.map(row => [
        row.createdAt.toISOString(),
        row.id,
        row.status,
        row.partnerUser.userId,
        row.quote.sourceAmount,
        row.quote.cryptoCurrency,
        row.quote.targetAmount,
        row.quote.targetCurrency,
        row.quote.network,
        row.quote.paymentMethod,
        row.onChainId ?? '',
      ]),
    ]

    return {
      csv: `${csvRows.map(row => row.map(value => this.toCsvCell(value)).join(',')).join('\r\n')}\r\n`,
      rowCount: exportedRows.length,
      truncated: rows.length > MAX_EXPORT_ROWS,
    }
  }

  public async getById(partnerId: string, transactionId: string): Promise<PartnerTransactionDetailDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const transaction = await prismaClient.transaction.findFirst({
      include: detailInclude,
      where: {
        id: transactionId,
        partnerUser: { partnerId },
      },
    })

    if (!transaction) {
      throw new PartnerTransactionNotFoundError()
    }

    const deliveries = await prismaClient.outboxEvent.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        attempts: true,
        payload: true,
        status: true,
        updatedAt: true,
      },
      take: MAX_DELIVERY_ROWS,
      where: {
        payload: {
          equals: transactionId,
          path: ['payload', 'data', 'id'],
        },
        type: 'webhook',
      },
    })

    return {
      ...this.toSummary(transaction),
      deliveries: deliveries.map(delivery => ({
        attempts: Math.max(1, delivery.attempts),
        event: this.readWebhookEvent(delivery.payload),
        lastAttemptAt: delivery.updatedAt,
        status: delivery.status,
      })),
      lifecycle: this.toLifecycle(transaction),
      payoutDestinationHint: this.maskDestination(transaction.accountNumber),
    }
  }

  public async search(
    partnerId: string,
    filters: PartnerTransactionSearchFilters,
  ): Promise<PartnerTransactionListResponse> {
    const normalizedFilters = this.normalizeFilters(filters)
    const prismaClient = await this.databaseClientProvider.getClient()
    const baseWhere = this.buildWhere(partnerId, normalizedFilters, false)
    const resultWhere = normalizedFilters.status
      ? { AND: [baseWhere, { status: normalizedFilters.status }] }
      : baseWhere

    const [rows, total, groupedStatuses] = await Promise.all([
      prismaClient.transaction.findMany({
        include: summaryInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (normalizedFilters.page - 1) * normalizedFilters.pageSize,
        take: normalizedFilters.pageSize,
        where: resultWhere,
      }),
      prismaClient.transaction.count({ where: resultWhere }),
      prismaClient.transaction.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: baseWhere,
      }),
    ])

    const counts = new Map(groupedStatuses.map(group => [group.status, group._count._all]))
    return {
      items: rows.map(row => this.toSummary(row)),
      page: normalizedFilters.page,
      pageSize: normalizedFilters.pageSize,
      statusCounts: transactionStatuses.map(status => ({ count: counts.get(status) ?? 0, status })),
      total,
    }
  }

  private buildWhere(
    partnerId: string,
    filters: NormalizedFilters,
    includeStatus: boolean,
  ): Prisma.TransactionWhereInput {
    const createdAt = this.createdAtFilter(filters.createdFrom, filters.createdTo)
    const where: Prisma.TransactionWhereInput = {
      partnerUser: { partnerId },
    }

    if (createdAt) {
      where.createdAt = createdAt
    }
    if (includeStatus && filters.status) {
      where.status = filters.status
    }
    if (filters.query) {
      where.OR = [
        { id: { contains: filters.query, mode: 'insensitive' } },
        { onChainId: { contains: filters.query, mode: 'insensitive' } },
        { partnerUser: { userId: { contains: filters.query, mode: 'insensitive' } } },
      ]
    }

    return where
  }

  private createdAtFilter(createdFrom?: Date, createdTo?: Date): Prisma.DateTimeFilter | undefined {
    if (!createdFrom && !createdTo) {
      return undefined
    }
    return {
      ...(createdFrom ? { gte: createdFrom } : {}),
      ...(createdTo ? { lt: createdTo } : {}),
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

  private normalizeFilters(filters: PartnerTransactionSearchFilters): NormalizedFilters {
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
    if (!Number.isInteger(page) || page < 1) {
      throw new PartnerTransactionQueryValidationError('Page must be a positive integer')
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new PartnerTransactionQueryValidationError(`Page size must be between 1 and ${MAX_PAGE_SIZE}`)
    }

    const query = filters.query?.trim() || undefined
    if (query && query.length > MAX_QUERY_LENGTH) {
      throw new PartnerTransactionQueryValidationError(`Search must be ${MAX_QUERY_LENGTH} characters or fewer`)
    }

    const createdFrom = this.parseCalendarDate(filters.createdFrom, false)
    const createdTo = this.parseCalendarDate(filters.createdTo, true)
    if (createdFrom && createdTo && createdFrom >= createdTo) {
      throw new PartnerTransactionQueryValidationError('Start date must be on or before end date')
    }

    return {
      createdFrom,
      createdTo,
      page,
      pageSize,
      query,
      status: filters.status,
    }
  }

  private parseCalendarDate(value: string | undefined, endExclusive: boolean): Date | undefined {
    if (!value) {
      return undefined
    }
    const match = ISO_DATE_PATTERN.exec(value)
    if (!match) {
      throw new PartnerTransactionQueryValidationError('Dates must use YYYY-MM-DD format')
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
      throw new PartnerTransactionQueryValidationError('Date is not a valid calendar day')
    }
    if (endExclusive) {
      date.setUTCDate(date.getUTCDate() + 1)
    }
    return date
  }

  private readWebhookEvent(payload: Prisma.JsonValue): PartnerTransactionDeliveryDto['event'] {
    if (!this.isJsonObject(payload)) {
      return 'unknown'
    }
    const nestedPayload = payload.payload
    if (!this.isJsonObject(nestedPayload)) {
      return 'unknown'
    }
    const event = nestedPayload.event
    return event === WebhookEvent.TRANSACTION_CREATED || event === WebhookEvent.TRANSACTION_UPDATED
      ? event
      : 'unknown'
  }

  private toCsvCell(value: Date | number | string): string {
    const normalized = value instanceof Date ? value.toISOString() : String(value)
    const spreadsheetSafe = typeof value === 'string' && FORMULA_PREFIX_PATTERN.test(normalized)
      ? `'${normalized}`
      : normalized
    return `"${spreadsheetSafe.replace(/"/g, '""')}"`
  }

  private toLifecycle(transaction: DetailRow): PartnerTransactionLifecycleDto[] {
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

  private toSummary(transaction: SummaryRow): PartnerTransactionSummaryDto {
    return {
      createdAt: transaction.createdAt,
      id: transaction.id,
      onChainId: transaction.onChainId,
      quote: {
        country: transaction.quote.country,
        cryptoCurrency: transaction.quote.cryptoCurrency,
        network: transaction.quote.network,
        paymentMethod: transaction.quote.paymentMethod,
        sourceAmount: transaction.quote.sourceAmount,
        targetAmount: transaction.quote.targetAmount,
        targetCurrency: transaction.quote.targetCurrency,
      },
      status: transaction.status,
      userReference: transaction.partnerUser.userId,
    }
  }
}

export class PartnerTransactionQueryValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerTransactionQueryValidationError'
  }
}
