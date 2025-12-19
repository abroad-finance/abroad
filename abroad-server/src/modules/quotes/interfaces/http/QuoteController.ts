// src/modules/quotes/interfaces/http/QuoteController.ts
import { BlockchainNetwork, CryptoCurrency, Partner, TargetCurrency } from '@prisma/client'
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
import { IPartnerService } from '../../../partners/application/contracts/IPartnerService'
import { SUPPORTED_PAYMENT_METHODS, SupportedPaymentMethod } from '../../../payments/application/supportedPaymentMethods'
import { IQuoteUseCase, QuoteResponse } from '../../application/quoteUseCase'

type PartnerResolution = { errorReason?: string, partner?: Partner }

type QuoteHandlerParams<TPayload> = {
  apiKey?: string
  badRequestResponse: TsoaResponse<400, { reason: string }>
  buildQuote: (payload: TPayload, partner: Partner | undefined) => Promise<QuoteResponse>
  request: RequestExpress
  requestBody: unknown
  schema: z.ZodSchema<TPayload>
}

// Zod schemas for validating input data.
const quoteRequestSchema = z.object({
  amount: z.number().positive(),
  crypto_currency: z.enum(CryptoCurrency),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(SUPPORTED_PAYMENT_METHODS),
  target_currency: z.enum(TargetCurrency),
})

type QuoteRequest = {
  amount: number
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: SupportedPaymentMethod
  target_currency: TargetCurrency
}

const reverseQuoteRequestSchema = z.object({
  crypto_currency: z.enum(CryptoCurrency),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(SUPPORTED_PAYMENT_METHODS),
  source_amount: z.number().positive(),
  target_currency: z.enum(TargetCurrency),
})

type ReverseQuoteRequest = {
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: SupportedPaymentMethod
  source_amount: number
  target_currency: TargetCurrency
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
      return { partner: request.user }
    }

    if (!normalizedApiKey) {
      return { partner: undefined }
    }

    try {
      const partner = await this.partnerService.getPartnerFromApiKey(normalizedApiKey)
      return { partner }
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Invalid API key'
      return { errorReason: reason }
    }
  }
}
