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
import { IPartnerService } from '../../../partners/application/contracts/IPartnerService'
import { IQuoteUseCase, QuoteResponse } from '../../application/quoteUseCase'
import { QuoteRequest, quoteRequestSchema, ReverseQuoteRequest, reverseQuoteRequestSchema } from './contracts'

type PartnerResolution = { errorReason?: string, partner?: Partner }

const BEARER_PREFIX = 'Bearer '

type QuoteHandlerParams<TPayload> = {
  apiKey?: string
  badRequestResponse: TsoaResponse<400, { reason: string }>
  buildQuote: (payload: TPayload, partner: Partner | undefined) => Promise<QuoteResponse>
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
  ) {
    super()
  }

  /**
   * Retrieves a quote to convert a given fiat amount into crypto.
   */
  @Post()
  @Response('400', 'Bad Request')
  @SuccessResponse('200', 'Quote response')
  public async getQuote(
    @Body() requestBody: QuoteRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
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
  @SuccessResponse('200', 'Reverse quote response')
  public async getReverseQuote(
    @Body() requestBody: ReverseQuoteRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
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
      request,
      requestBody,
      schema,
    } = params

    const parsed = schema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }

    const { errorReason, partner } = await this.resolvePartner(request, apiKey)
    if (errorReason) {
      return badRequestResponse(400, { reason: errorReason })
    }

    try {
      return await buildQuote(parsed.data, partner)
    }
    catch (error) {
      if (error instanceof Error) {
        return badRequestResponse(400, { reason: error.message })
      }
      this.setStatus(500)
      return { expiration_time: 0, quote_id: 'error', value: 0 }
    }
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
        const reason = error instanceof Error ? error.message : 'Invalid API key'
        return { errorReason: reason }
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
        const reason = error instanceof Error ? error.message : 'Invalid Bearer token'
        return { errorReason: reason }
      }
    }

    return { partner: undefined }
  }
}
