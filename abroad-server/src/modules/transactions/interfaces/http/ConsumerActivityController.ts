import type { Request as ExpressRequest } from 'express'

import { BlockchainNetwork, PaymentMethod, TargetCurrency, TransactionStatus } from '@prisma/client'
import { inject } from 'inversify'
import {
  Controller,
  Get,
  OperationId,
  Path,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { requireAuthenticatedWalletPrincipal } from '../../../../app/http/authenticationContext'
import {
  ConsumerActivityListResponse,
  ConsumerActivityNotFoundError,
  ConsumerActivityReceiptDto,
  ConsumerActivityService,
  ConsumerActivitySort,
  ConsumerActivityValidationError,
  IConsumerActivityService,
} from '../../application/ConsumerActivityService'
import {
  IPartnerPixReceiptService,
  PartnerPixReceiptDto,
  PartnerPixReceiptLanguage,
  PartnerPixReceiptNotFoundError,
  PartnerPixReceiptProviderError,
  PartnerPixReceiptService,
  PartnerPixReceiptUnavailableError,
} from '../../application/PartnerPixReceiptService'

type ConsumerActivityErrorResponse = { reason: string }

@Route('activity')
@Security('BearerAuth')
export class ConsumerActivityController extends Controller {
  public constructor(
    @inject(ConsumerActivityService)
    private readonly activityService: IConsumerActivityService,
    @inject(PartnerPixReceiptService)
    private readonly receiptService: IPartnerPixReceiptService,
  ) {
    super()
  }

  @Get('{transactionId}')
  @OperationId('GetConsumerActivity')
  @Response<ConsumerActivityErrorResponse>(400, 'Bad Request')
  @Response<ConsumerActivityErrorResponse>(404, 'Not Found')
  @SuccessResponse('200', 'Activity transaction retrieved')
  public async getActivity(
    @Path() transactionId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ConsumerActivityErrorResponse>,
    @Res() notFound: TsoaResponse<404, ConsumerActivityErrorResponse>,
  ): Promise<ConsumerActivityReceiptDto> {
    this.setHeader('Cache-Control', 'private, no-store')
    const principal = requireAuthenticatedWalletPrincipal(request.user)
    try {
      return await this.activityService.getById(
        principal.id,
        principal.authenticatedSubject,
        transactionId,
      )
    }
    catch (error) {
      if (error instanceof ConsumerActivityValidationError) {
        return badRequest(400, { reason: error.message })
      }
      if (error instanceof ConsumerActivityNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Get('{transactionId}/receipt')
  @OperationId('GetConsumerActivityReceipt')
  @Response<ConsumerActivityErrorResponse>(400, 'Bad Request')
  @Response<ConsumerActivityErrorResponse>(404, 'Not Found')
  @Response<ConsumerActivityErrorResponse>(409, 'Conflict')
  @Response<ConsumerActivityErrorResponse>(502, 'Bad Gateway')
  @SuccessResponse('200', 'Activity receipt retrieved')
  public async getReceipt(
    @Path() transactionId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ConsumerActivityErrorResponse>,
    @Res() notFound: TsoaResponse<404, ConsumerActivityErrorResponse>,
    @Res() unavailable: TsoaResponse<409, ConsumerActivityErrorResponse>,
    @Res() badGateway: TsoaResponse<502, ConsumerActivityErrorResponse>,
    @Query() lang: PartnerPixReceiptLanguage = 'pt-BR',
  ): Promise<PartnerPixReceiptDto> {
    this.setHeader('Cache-Control', 'private, no-store')
    if (lang !== 'pt-BR' && lang !== 'en') {
      return badRequest(400, { reason: 'Receipt language must be pt-BR or en' })
    }

    const principal = requireAuthenticatedWalletPrincipal(request.user)
    try {
      // Authorization is deliberately performed against the consumer Activity
      // owner before the partner-scoped provider receipt service is called.
      await this.activityService.getById(
        principal.id,
        principal.authenticatedSubject,
        transactionId,
      )
      return await this.receiptService.getReceipt(principal.id, transactionId, lang)
    }
    catch (error) {
      if (error instanceof ConsumerActivityValidationError) {
        return badRequest(400, { reason: error.message })
      }
      if (
        error instanceof ConsumerActivityNotFoundError
        || error instanceof PartnerPixReceiptNotFoundError
      ) {
        return notFound(404, { reason: 'Activity transaction not found' })
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

  @Get()
  @OperationId('ListConsumerActivity')
  @Response<ConsumerActivityErrorResponse>(400, 'Bad Request')
  @SuccessResponse('200', 'Activity transactions retrieved')
  public async listActivity(
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, ConsumerActivityErrorResponse>,
    @Query() status?: TransactionStatus,
    @Query() paymentMethod?: PaymentMethod,
    @Query() network?: BlockchainNetwork,
    @Query() targetCurrency?: TargetCurrency,
    @Query() createdFrom?: string,
    @Query() createdTo?: string,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() sort: ConsumerActivitySort = 'newest',
  ): Promise<ConsumerActivityListResponse> {
    this.setHeader('Cache-Control', 'private, no-store')
    const principal = requireAuthenticatedWalletPrincipal(request.user)
    try {
      return await this.activityService.list(
        principal.id,
        principal.authenticatedSubject,
        {
          createdFrom,
          createdTo,
          network,
          page,
          pageSize,
          paymentMethod,
          sort,
          status,
          targetCurrency,
        },
      )
    }
    catch (error) {
      if (error instanceof ConsumerActivityValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }
}
