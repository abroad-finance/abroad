import type { Request as ExpressRequest } from 'express'

import { TransactionStatus } from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Path,
  Post,
  Produces,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { PartnerPortalAccountService, PartnerPortalAccountValidationError, PartnerPortalAuthenticationError, PartnerPortalCredentials } from '../../../partners/application/PartnerPortalAccountService'
import { PartnerPortalSession } from '../../../partners/application/PartnerPortalSessionService'
import {
  PartnerTransactionDetailDto,
  PartnerTransactionListResponse,
  PartnerTransactionNotFoundError,
  PartnerTransactionQueryService,
  PartnerTransactionQueryValidationError,
  PartnerTransactionSearchFilters,
} from '../../application/PartnerTransactionQueryService'

type ErrorResponse = { reason: string }

const partnerPortalLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict() satisfies z.ZodType<PartnerPortalCredentials>

@Route('partner-portal')
export class PartnerPortalController extends Controller {
  public constructor(
    @inject(PartnerPortalAccountService)
    private readonly accountService: PartnerPortalAccountService,
    @inject(PartnerTransactionQueryService)
    private readonly transactionQueryService: PartnerTransactionQueryService,
  ) {
    super()
  }

  @OperationId('CreatePartnerPortalSession')
  @Post('session')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @SuccessResponse('200', 'Partner portal session created')
  public async createSession(
    @Body() body: PartnerPortalCredentials,
    @Res() badRequest: TsoaResponse<400, ErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, ErrorResponse>,
  ): Promise<PartnerPortalSession> {
    this.setHeader('Cache-Control', 'no-store')
    const parsedBody = partnerPortalLoginSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: 'Enter a valid email and password' })
    }

    try {
      return await this.accountService.authenticate(parsedBody.data)
    }
    catch (error) {
      if (error instanceof PartnerPortalAuthenticationError) {
        return unauthorized(401, { reason: error.message })
      }
      if (error instanceof PartnerPortalAccountValidationError) {
        return badRequest(400, { reason: 'Enter a valid email and password' })
      }
      throw error
    }
  }

  @Get('transactions/export.csv')
  @OperationId('ExportPartnerPortalTransactions')
  @Produces('text/csv')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('PartnerPortalAuth')
  public async exportTransactions(
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ErrorResponse>,
    @Query() query?: string,
    @Query() status?: TransactionStatus,
    @Query() createdFrom?: string,
    @Query() createdTo?: string,
  ): Promise<string> {
    try {
      const result = await this.transactionQueryService.exportCsv(
        request.user.id,
        this.toFilters(query, status, createdFrom, createdTo),
      )
      this.setHeader('Cache-Control', 'private, no-store')
      this.setHeader('Content-Disposition', 'attachment; filename="abroad-transactions.csv"')
      this.setHeader('Content-Type', 'text/csv; charset=utf-8')
      this.setHeader('X-Export-Row-Count', String(result.rowCount))
      this.setHeader('X-Export-Truncated', String(result.truncated))
      return result.csv
    }
    catch (error) {
      if (error instanceof PartnerTransactionQueryValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Get('transactions/{transactionId}')
  @OperationId('GetPartnerPortalTransaction')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('PartnerPortalAuth')
  public async getTransaction(
    @Path() transactionId: string,
    @Request() request: ExpressRequest,
    @Res() notFound: TsoaResponse<404, ErrorResponse>,
  ): Promise<PartnerTransactionDetailDto> {
    try {
      this.setHeader('Cache-Control', 'private, no-store')
      return await this.transactionQueryService.getById(request.user.id, transactionId)
    }
    catch (error) {
      if (error instanceof PartnerTransactionNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Get('transactions')
  @OperationId('ListPartnerPortalTransactions')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('PartnerPortalAuth')
  public async listTransactions(
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ErrorResponse>,
    @Query() query?: string,
    @Query() status?: TransactionStatus,
    @Query() createdFrom?: string,
    @Query() createdTo?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<PartnerTransactionListResponse> {
    try {
      this.setHeader('Cache-Control', 'private, no-store')
      return await this.transactionQueryService.search(
        request.user.id,
        this.toFilters(query, status, createdFrom, createdTo, page, pageSize),
      )
    }
    catch (error) {
      if (error instanceof PartnerTransactionQueryValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  private toFilters(
    query?: string,
    status?: TransactionStatus,
    createdFrom?: string,
    createdTo?: string,
    page?: number,
    pageSize?: number,
  ): PartnerTransactionSearchFilters {
    return {
      createdFrom,
      createdTo,
      page,
      pageSize,
      query,
      status,
    }
  }
}
