import type { Request as ExpressRequest } from 'express'

import { TransactionStatus } from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Header,
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

import { requirePartnerPortalMfaAdministrator, requirePartnerPortalPrincipal } from '../../../../app/http/authenticationContext'
import {
  PartnerPortalAccountService,
  PartnerPortalAccountValidationError,
  PartnerPortalAuthenticationError,
  PartnerPortalCredentials,
  PartnerPortalLoginResult,
} from '../../../partners/application/PartnerPortalAccountService'
import {
  PartnerPixReceiptDto,
  PartnerPixReceiptLanguage,
  PartnerPixReceiptNotFoundError,
  PartnerPixReceiptProviderError,
  PartnerPixReceiptService,
  PartnerPixReceiptUnavailableError,
} from '../../application/PartnerPixReceiptService'
import {
  PartnerPixReconciliationNotFoundError,
  PartnerPixReconciliationRunDto,
  PartnerPixReconciliationRunList,
  PartnerPixReconciliationService,
  PartnerPixReconciliationValidationError,
} from '../../application/PartnerPixReconciliationService'
import {
  PartnerTransactionDetailDto,
  PartnerTransactionListResponse,
  PartnerTransactionNotFoundError,
  PartnerTransactionQueryService,
  PartnerTransactionQueryValidationError,
  PartnerTransactionSearchFilters,
} from '../../application/PartnerTransactionQueryService'
import { PartnerWebhookRedeliveryNotFoundError, PartnerWebhookRedeliveryResult, PartnerWebhookRedeliveryService, PartnerWebhookRedeliveryValidationError } from '../../application/PartnerWebhookRedeliveryService'

type ErrorResponse = { reason: string }

const partnerPortalLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict() satisfies z.ZodType<PartnerPortalCredentials>

const pixReceiptLanguageSchema = z.enum(['pt-BR', 'en'])

const reconciliationStartSchema = z.object({
  batchSize: z.number().int().min(1).max(5).optional(),
}).strict()

@Route('partner-portal')
export class PartnerPortalController extends Controller {
  public constructor(
    @inject(PartnerPortalAccountService)
    private readonly accountService: PartnerPortalAccountService,
    @inject(PartnerTransactionQueryService)
    private readonly transactionQueryService: PartnerTransactionQueryService,
    @inject(PartnerPixReceiptService)
    private readonly pixReceiptService: PartnerPixReceiptService,
    @inject(PartnerPixReconciliationService)
    private readonly pixReconciliationService: PartnerPixReconciliationService,
    @inject(PartnerWebhookRedeliveryService)
    private readonly webhookRedeliveryService: PartnerWebhookRedeliveryService,
  ) {
    super()
  }

  @OperationId('ContinuePartnerPortalPixReconciliation')
  @Post('reconciliation-runs/{runId}/continue')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('PartnerPortalAuth', ['admin', 'mfa'])
  @SuccessResponse('200', 'PIX reconciliation batch completed')
  public async continuePixReconciliation(
    @Path() runId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ErrorResponse>,
    @Res() notFound: TsoaResponse<404, ErrorResponse>,
  ): Promise<PartnerPixReconciliationRunDto> {
    try {
      return await this.pixReconciliationService.continue(
        requirePartnerPortalMfaAdministrator(request.user),
        runId,
      )
    }
    catch (error) {
      if (error instanceof PartnerPixReconciliationValidationError) {
        return badRequest(400, { reason: error.message })
      }
      if (error instanceof PartnerPixReconciliationNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
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
  ): Promise<PartnerPortalLoginResult> {
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
        requirePartnerPortalPrincipal(request.user).partner.id,
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

  @Get('transactions/{transactionId}/receipt')
  @OperationId('GetPartnerPortalPixReceipt')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Response<502, { reason: string }>(502, 'Bad Gateway')
  @Security('PartnerPortalAuth')
  public async getPixReceipt(
    @Path() transactionId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ErrorResponse>,
    @Res() notFound: TsoaResponse<404, ErrorResponse>,
    @Res() unavailable: TsoaResponse<409, ErrorResponse>,
    @Res() badGateway: TsoaResponse<502, ErrorResponse>,
    @Query() lang: PartnerPixReceiptLanguage = 'pt-BR',
  ): Promise<PartnerPixReceiptDto> {
    const parsedLanguage = pixReceiptLanguageSchema.safeParse(lang)
    if (!parsedLanguage.success) {
      return badRequest(400, { reason: 'Receipt language must be pt-BR or en' })
    }
    try {
      this.setHeader('Cache-Control', 'private, no-store')
      return await this.pixReceiptService.getReceipt(
        requirePartnerPortalPrincipal(request.user).partner.id,
        transactionId,
        parsedLanguage.data,
      )
    }
    catch (error) {
      if (error instanceof PartnerPixReceiptNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof PartnerPixReceiptUnavailableError) {
        return unavailable(409, { reason: error.message })
      }
      if (error instanceof PartnerPixReceiptProviderError) {
        return badGateway(502, { reason: error.message })
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
      return await this.transactionQueryService.getById(
        requirePartnerPortalPrincipal(request.user).partner.id,
        transactionId,
      )
    }
    catch (error) {
      if (error instanceof PartnerTransactionNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Get('reconciliation-runs')
  @OperationId('ListPartnerPortalPixReconciliations')
  @Security('PartnerPortalAuth', ['admin', 'mfa'])
  public async listPixReconciliations(
    @Request() request: ExpressRequest,
  ): Promise<PartnerPixReconciliationRunList> {
    const principal = requirePartnerPortalMfaAdministrator(request.user)
    return this.pixReconciliationService.list(principal.partner.id)
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
        requirePartnerPortalPrincipal(request.user).partner.id,
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

  @OperationId('RedeliverPartnerPortalTransactionWebhook')
  @Post('transactions/{transactionId}/deliveries/{deliveryId}/redelivery')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('PartnerPortalAuth', ['admin', 'mfa'])
  @SuccessResponse('200', 'Webhook redelivery requested')
  public async redeliverWebhook(
    @Path() transactionId: string,
    @Path() deliveryId: string,
    @Header('Idempotency-Key') idempotencyKey: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ErrorResponse>,
    @Res() notFound: TsoaResponse<404, ErrorResponse>,
  ): Promise<PartnerWebhookRedeliveryResult> {
    try {
      return await this.webhookRedeliveryService.redeliver(
        requirePartnerPortalMfaAdministrator(request.user),
        transactionId,
        deliveryId,
        idempotencyKey,
      )
    }
    catch (error) {
      if (error instanceof PartnerWebhookRedeliveryValidationError) {
        return badRequest(400, { reason: error.message })
      }
      if (error instanceof PartnerWebhookRedeliveryNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('StartPartnerPortalPixReconciliation')
  @Post('reconciliation-runs')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('PartnerPortalAuth', ['admin', 'mfa'])
  @SuccessResponse('201', 'PIX reconciliation started')
  public async startPixReconciliation(
    @Body() body: { batchSize?: number },
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ErrorResponse>,
    @Res() created: TsoaResponse<201, PartnerPixReconciliationRunDto>,
  ): Promise<PartnerPixReconciliationRunDto> {
    const parsed = reconciliationStartSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Batch size must be between 1 and 5' })
    }
    try {
      const result = await this.pixReconciliationService.start(
        requirePartnerPortalMfaAdministrator(request.user),
        parsed.data.batchSize,
      )
      return created(201, result)
    }
    catch (error) {
      if (error instanceof PartnerPixReconciliationValidationError) {
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
