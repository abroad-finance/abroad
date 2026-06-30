import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

export type OpsTransactionDetailDto = OpsTransactionSummaryDto & {
  accountNumber: string
  bankCode: string
  exchangeHandoffAt: Date | null
  flowInstanceId: null | string
  qrCode: null | string
  refundOnChainId: null | string
  taxId: null | string
}

export type OpsTransactionListResponse = {
  items: OpsTransactionSummaryDto[]
  page: number
  pageSize: number
  total: number
}

export type OpsTransactionQuoteDto = {
  country: Country
  cryptoCurrency: CryptoCurrency
  network: BlockchainNetwork
  paymentMethod: PaymentMethod
  sourceAmount: number
  targetAmount: number
  targetCurrency: TargetCurrency
}

export type OpsTransactionSearchFilters = {
  externalId?: string
  onChainId?: string
  page?: number
  pageSize?: number
  partnerId?: string
  status?: TransactionStatus
  userId?: string
}

export type OpsTransactionSummaryDto = {
  createdAt: Date
  externalId: null | string
  id: string
  onChainId: null | string
  partnerId: string
  quote: OpsTransactionQuoteDto
  status: TransactionStatus
  userId: string
}

export class OpsTransactionNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpsTransactionNotFoundError'
  }
}

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/**
 * Read model backing the ops transaction lookup/search surface. Pure queries —
 * no mutations — so it is safe to call from the ops dashboard.
 */
@injectable()
export class OpsTransactionQueryService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async getById(transactionId: string): Promise<OpsTransactionDetailDto> {
    const client = await this.dbProvider.getClient()
    const transaction = await client.transaction.findUnique({
      include: { partnerUser: true, quote: true },
      where: { id: transactionId },
    })

    if (!transaction) {
      throw new OpsTransactionNotFoundError('Transaction not found')
    }

    const flowInstance = await client.flowInstance.findUnique({
      select: { id: true },
      where: { transactionId },
    })

    return {
      ...this.toSummary(transaction),
      accountNumber: transaction.accountNumber,
      bankCode: transaction.bankCode,
      exchangeHandoffAt: transaction.exchangeHandoffAt,
      flowInstanceId: flowInstance?.id ?? null,
      qrCode: transaction.qrCode,
      refundOnChainId: transaction.refundOnChainId,
      taxId: transaction.taxId,
    }
  }

  public async search(filters: OpsTransactionSearchFilters): Promise<OpsTransactionListResponse> {
    const client = await this.dbProvider.getClient()
    const page = Math.max(1, Math.trunc(filters.page ?? 1))
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(filters.pageSize ?? DEFAULT_PAGE_SIZE)))
    const where = this.buildWhere(filters)

    const [rows, total] = await Promise.all([
      client.transaction.findMany({
        include: { partnerUser: true, quote: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      client.transaction.count({ where }),
    ])

    return {
      items: rows.map(row => this.toSummary(row)),
      page,
      pageSize,
      total,
    }
  }

  private buildWhere(filters: OpsTransactionSearchFilters): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {}
    if (filters.status) where.status = filters.status
    if (filters.onChainId) where.onChainId = filters.onChainId
    if (filters.externalId) where.externalId = filters.externalId

    const partnerUser: Prisma.PartnerUserWhereInput = {}
    if (filters.partnerId) partnerUser.partnerId = filters.partnerId
    if (filters.userId) partnerUser.userId = filters.userId
    if (Object.keys(partnerUser).length > 0) where.partnerUser = partnerUser

    return where
  }

  private toSummary(transaction: {
    createdAt: Date
    externalId: null | string
    id: string
    onChainId: null | string
    partnerUser: { partnerId: string, userId: string }
    quote: OpsTransactionQuoteDto
    status: TransactionStatus
  }): OpsTransactionSummaryDto {
    return {
      createdAt: transaction.createdAt,
      externalId: transaction.externalId,
      id: transaction.id,
      onChainId: transaction.onChainId,
      partnerId: transaction.partnerUser.partnerId,
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
      userId: transaction.partnerUser.userId,
    }
  }
}
