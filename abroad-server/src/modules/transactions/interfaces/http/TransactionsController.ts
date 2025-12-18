import { TargetCurrency, Transaction, TransactionStatus } from '@prisma/client'
// src/modules/transactions/interfaces/http/TransactionsController.ts
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Controller,
  Get,
  Hidden,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { IPartnerService } from '../../../partners/application/contracts/IPartnerService'
import { toWebhookTransactionPayload } from '../../application/transactionPayload'

interface PaginatedTransactionList {
  page: number
  pageSize: number
  total: number
  transactions: TransactionListItem[]
}

type TransactionListItem = Omit<Transaction, 'bankCode'> & {
  quote: {
    cryptoCurrency: string
    id: string
    network: string
    paymentMethod: string
    sourceAmount: number
    targetAmount: number
    targetCurrency: TargetCurrency
  }
}

@Route('transactions')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class TransactionsController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPartnerService) private partnerService: IPartnerService,
  ) {
    super()
  }

  /**
   * List confirmed partner transactions (paginated)
   */
  @Get('list/confirmed')
  @Hidden()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Confirmed transactions retrieved')
  public async listConfirmedPartnerTransactions(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PaginatedTransactionList> {
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return badRequest(400, { reason: 'Invalid pagination parameters' })
    }
    const partner = request.user
    const prismaClient = await this.prismaClientProvider.getClient()
    const whereClause = {
      partnerUser: { partnerId: partner.id },
      status: TransactionStatus.PAYMENT_COMPLETED,
    }
    const [transactions, total] = await Promise.all([
      prismaClient.transaction.findMany({
        include: { quote: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where: whereClause,
      }),
      prismaClient.transaction.count({ where: whereClause }),
    ])
    const sanitizedTransactions = transactions.map(transaction => toWebhookTransactionPayload(transaction))
    return { page, pageSize, total, transactions: sanitizedTransactions }
  }

  /**
   * List partner transactions (paginated)
   */
  @Get('list')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Transactions retrieved')
  public async listPartnerTransactions(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() externalUserId: string,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PaginatedTransactionList> {
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return badRequest(400, { reason: 'Invalid pagination parameters' })
    }
    const partner = request.user
    const prismaClient = await this.prismaClientProvider.getClient()
    const [transactions, total] = await Promise.all([
      prismaClient.transaction.findMany({
        include: { quote: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where: { partnerUser: { partnerId: partner.id, userId: externalUserId } },
      }),
      prismaClient.transaction.count({ where: { partnerUser: { partnerId: partner.id, userId: externalUserId } } }),
    ])
    const sanitizedTransactions = transactions.map(transaction => toWebhookTransactionPayload(transaction))
    return { page, pageSize, total, transactions: sanitizedTransactions }
  }
}
