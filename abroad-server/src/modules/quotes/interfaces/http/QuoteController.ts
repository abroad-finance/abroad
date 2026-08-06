// src/modules/quotes/interfaces/http/QuoteController.ts
import { Partner } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Header,
  Post,
  Request,
  Res,
  Response,
  Route,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { requireAuthenticatedPartner } from '../../../../app/http/authenticationContext'
import { ILogger } from '../../../../core/logging/types'
import { IPartnerService } from '../../../partners/application/contracts/IPartnerService'
import { CorridorNotConfiguredError } from '../../application/errors/CorridorNotConfiguredError'
import { QuoteRequestError, QuoteRequestErrorCode } from '../../application/errors/QuoteRequestError'
import { IQuoteUseCase, QuoteResponse } from '../../application/quoteUseCase'
import {
  OnrampQuoteRequest,
  onrampQuoteRequestSchema,
  QuoteRequest,
  quoteRequestSchema,
  ReverseQuoteRequest,
  reverseQuoteRequestSchema,
} from './contracts'

type QuoteErrorResponse = {
  code: QuoteErrorCode
  reason: string
  retryable: boolean
}

type PartnerResolution = { errorReason?: string, partner?: Partner }

type QuoteErrorCode
  = | 'authentication_failed'
    | 'invalid_request'
    | 'server_error'
    | QuoteRequestErrorCode

const BEARER_PREFIX = 'Bearer '

type QuoteHandlerParams<TPayload> = {
  apiKey?: string
  badRequestResponse: TsoaResponse<400, QuoteErrorResponse>
  buildQuote: (payload: TPayload, partner: Partner | undefined) => Promise<QuoteResponse>
  internalServerErrorResponse: TsoaResponse<500, QuoteErrorResponse>
  request: RequestExpress
  requestBody: unknown
  schema: z.ZodSchema<TPayload>
}

@Route('quote')
export class QuoteController extends Controller {
  constructor(
    @inject(TYPES.QuoteUseCase)
    private quoteUseCase: IQuoteUseCase,
    @inject(TYPES.IPartnerService)
    private partnerService: IPartnerService,
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
  ) {
    super()
  }

  /**
   * Retrieves an onramp quote: given the fiat amount the user will pay, it
   * returns the crypto amount they receive. `value` is the crypto amount.
   */
  @Post('/onramp')
  @Response('400', 'Bad Request')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Onramp quote response')
  public async getOnrampQuote(
    @Body() requestBody: OnrampQuoteRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, QuoteErrorResponse>,
    @Res() internalServerErrorResponse: TsoaResponse<500, QuoteErrorResponse>,
    @Header('X-API-Key') apiKey?: string,
  ): Promise<QuoteResponse> {
    return this.handleQuoteRequest({
      apiKey,
      badRequestResponse,
      buildQuote: async (payload, partner) => this.quoteUseCase.createOnrampQuote({
        cryptoCurrency: payload.crypto_currency,
        fiatAmount: payload.fiat_amount,
        network: payload.network,
        partner,
        paymentMethod: payload.payment_method,
        targetCurrency: payload.target_currency,
      }),
      internalServerErrorResponse,
      request,
      requestBody,
      schema: onrampQuoteRequestSchema,
    })
  }

  /**
   * Retrieves a quote to convert a given fiat amount into crypto.
   */
  @Post()
  @Response('400', 'Bad Request')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Quote response')
  public async getQuote(
    @Body() requestBody: QuoteRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, QuoteErrorResponse>,
    @Res() internalServerErrorResponse: TsoaResponse<500, QuoteErrorResponse>,
    @Header('X-API-Key') apiKey?: string,
  ): Promise<QuoteResponse> {
    return this.handleQuoteRequest({
      apiKey,
      badRequestResponse,
      buildQuote: async (payload, partner) => this.quoteUseCase.createQuote({
        amount: payload.amount,
        cryptoCurrency: payload.crypto_currency,
        network: payload.network,
        partner,
        paymentMethod: payload.payment_method,
        targetCurrency: payload.target_currency,
      }),
      internalServerErrorResponse,
      request,
      requestBody,
      schema: quoteRequestSchema,
    })
  }

  /**
   * Retrieves a reverse quote: given the crypto amount the user sends,
   * it returns the fiat amount (target amount) they would receive.
   */
  @Post('/reverse')
  @Response('400', 'Bad Request')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Reverse quote response')
  public async getReverseQuote(
    @Body() requestBody: ReverseQuoteRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, QuoteErrorResponse>,
    @Res() internalServerErrorResponse: TsoaResponse<500, QuoteErrorResponse>,
    @Header('X-API-Key') apiKey?: string,
  ): Promise<QuoteResponse> {
    return this.handleQuoteRequest({
      apiKey,
      badRequestResponse,
      buildQuote: async (payload, partner) => this.quoteUseCase.createReverseQuote({
        cryptoCurrency: payload.crypto_currency,
        network: payload.network,
        partner,
        paymentMethod: payload.payment_method,
        sourceAmountInput: payload.source_amount,
        targetCurrency: payload.target_currency,
      }),
      internalServerErrorResponse,
      request,
      requestBody,
      schema: reverseQuoteRequestSchema,
    })
  }

  private async handleQuoteRequest<TPayload>(
    params: QuoteHandlerParams<TPayload>,
  ): Promise<QuoteResponse> {
    const {
      apiKey,
      badRequestResponse,
      buildQuote,
      internalServerErrorResponse,
      request,
      requestBody,
      schema,
    } = params

    const parsed = schema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, {
        code: 'invalid_request',
        reason: 'The quote request is invalid',
        retryable: false,
      })
    }

    const { errorReason, partner } = await this.resolvePartner(request, apiKey)
    if (errorReason) {
      return badRequestResponse(400, {
        code: 'authentication_failed',
        reason: errorReason,
        retryable: false,
      })
    }

    try {
      return await buildQuote(parsed.data, partner)
    }
    catch (error) {
      if (error instanceof QuoteRequestError) {
        const response = {
          code: error.code,
          reason: error.message,
          retryable: error.retryable,
        }
        return error.status === 400
          ? badRequestResponse(400, response)
          : internalServerErrorResponse(500, response)
      }
      if (error instanceof CorridorNotConfiguredError) {
        return badRequestResponse(400, {
          code: 'corridor_unavailable',
          reason: 'The selected payment route is currently unavailable',
          retryable: false,
        })
      }
      this.logger.error('[QuoteController] quote request failed', {
        errorName: error instanceof Error ? error.name : typeof error,
      })
      return internalServerErrorResponse(500, {
        code: 'server_error',
        reason: 'Unable to create quote',
        retryable: true,
      })
    }
  }

  private logAuthenticationFailure(method: 'api_key' | 'bearer', error: unknown): void {
    this.logger.warn('[QuoteController] quote authentication failed', {
      errorName: error instanceof Error ? error.name : typeof error,
      method,
    })
  }

  private async resolvePartner(
    request: RequestExpress,
    apiKey?: string,
  ): Promise<PartnerResolution> {
    const normalizedApiKey = apiKey?.trim()

    if (request.user) {
      return { partner: requireAuthenticatedPartner(request.user) }
    }

    if (normalizedApiKey) {
      try {
        const partner = await this.partnerService.getPartnerFromApiKey(normalizedApiKey)
        return { partner }
      }
      catch (error) {
        this.logAuthenticationFailure('api_key', error)
        return { errorReason: 'Invalid API key' }
      }
    }

    const authorization = request.header('Authorization')
    if (authorization?.startsWith(BEARER_PREFIX)) {
      const token = authorization.slice(BEARER_PREFIX.length).trim()
      if (!token) {
        return { errorReason: 'Invalid Bearer token' }
      }

      try {
        const authentication = await this.partnerService.authenticateBearerToken(token)
        return { partner: authentication.partner }
      }
      catch (error) {
        this.logAuthenticationFailure('bearer', error)
        return { errorReason: 'Invalid Bearer token' }
      }
    }

    return { partner: undefined }
  }
}
