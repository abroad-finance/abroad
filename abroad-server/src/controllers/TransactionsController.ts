import { Transaction, TransactionStatus } from '@prisma/client'
// src/controllers/TransactionsController.ts
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

import { IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { TYPES } from '../types'

interface PaginatedTransactionList {
  page: number
  pageSize: number
  total: number
  transactions: Array<Transaction & { quote: { cryptoCurrency: string, id: string, network: string, paymentMethod: string, sourceAmount: number, targetAmount: number, targetCurrency: string } }>
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
    return { page, pageSize, total, transactions }
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
    return { page, pageSize, total, transactions }
  }
}
