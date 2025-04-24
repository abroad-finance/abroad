// src/controllers/PartnerUserController.ts

import { KycStatus, PaymentMethod } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { TYPES } from '../types'

export interface CreatePartnerUserRequest {
  account_number?: string
  bank?: string
  payment_method?: PaymentMethod
  user_id: string
}

export interface CreatePartnerUserResponse {
  accountNumber: null | string
  bank: null | string
  createdAt: Date
  id: string
  kycStatus: KycStatus
  paymentMethod: null | PaymentMethod
  updatedAt: Date
  userId: string
}

export interface PaginatedPartnerUsers {
  page: number
  pageSize: number
  total: number
  users: Array<{
    accountNumber: null | string
    bank: null | string
    createdAt: Date
    id: string
    kycStatus: KycStatus
    paymentMethod: null | PaymentMethod
    updatedAt: Date
    userId: string
  }>
}

@Route('partnerUser')
@Security('BearerAuth')
@Security('ApiKeyAuth')
export class PartnerUserController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private dbProvider: IDatabaseClientProvider,
  ) {
    super()
  }

  /**
       * Create a partner user under the current partner
       */
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Partner user created')
  public async createPartnerUser(
    @Body() body: CreatePartnerUserRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<CreatePartnerUserResponse> {
    const { account_number, bank, payment_method, user_id } = body
    if (!user_id) {
      return badRequest(400, { reason: 'user_id is required' })
    }
    const partner = request.user
    const prisma = await this.dbProvider.getClient()
    try {
      const pu = await prisma.partnerUser.create({
        data: {
          accountNumber: account_number,
          bank: bank,
          partnerId: partner.id,
          paymentMethod: payment_method,
          userId: user_id,
        },
      })
      return {
        accountNumber: pu.accountNumber,
        bank: pu.bank,
        createdAt: pu.createdAt,
        id: pu.id,
        kycStatus: pu.kycStatus,
        paymentMethod: pu.paymentMethod,
        updatedAt: pu.updatedAt,
        userId: pu.userId,
      }
    }
    catch {
      return badRequest(400, { reason: 'Failed to create partner user' })
    }
  }

  /**
 * List partner users (paginated)
 */
  @Get('list')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Partner users retrieved')
  public async listPartnerUsers(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PaginatedPartnerUsers> {
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return badRequest(400, { reason: 'Invalid pagination parameters' })
    }
    const partner = request.user
    const prisma = await this.dbProvider.getClient()
    const [users, total] = await Promise.all([
      prisma.partnerUser.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where: { partnerId: partner.id },
      }),
      prisma.partnerUser.count({ where: { partnerId: partner.id } }),
    ])
    return {
      page,
      pageSize,
      total,
      users: users.map(u => ({
        accountNumber: u.accountNumber,
        bank: u.bank,
        createdAt: u.createdAt,
        id: u.id,
        kycStatus: u.kycStatus,
        paymentMethod: u.paymentMethod,
        updatedAt: u.updatedAt,
        userId: u.userId,
      })),
    }
  }
}
