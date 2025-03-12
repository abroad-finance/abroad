import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '.prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Post,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { TYPES } from '../types'
import { QuoteResponse, QuoteUseCase } from '../useCases/quoteUseCase'

// Zod schemas for validating input data.
const quoteRequestSchema = z.object({
  amount: z.number().positive(),
  crypto_currency: z.nativeEnum(CryptoCurrency),
  network: z.nativeEnum(BlockchainNetwork),
  payment_method: z.nativeEnum(PaymentMethod),
  target_currency: z.nativeEnum(TargetCurrency),
})

type QuoteRequest = z.infer<typeof quoteRequestSchema>

const reverseQuoteRequestSchema = z.object({
  crypto_currency: z.nativeEnum(CryptoCurrency),
  network: z.nativeEnum(BlockchainNetwork),
  payment_method: z.nativeEnum(PaymentMethod),
  source_amount: z.number().positive(),
  target_currency: z.nativeEnum(TargetCurrency),
})

type ReverseQuoteRequest = z.infer<typeof reverseQuoteRequestSchema>

@Route('quote')
@Security('ApiKeyAuth')
export class QuoteController extends Controller {
  constructor(
    @inject(TYPES.QuoteUseCase)
    private quoteUseCase: QuoteUseCase,
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
  ): Promise<QuoteResponse> {
    const parsed = quoteRequestSchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }
    const { amount, crypto_currency, network, payment_method, target_currency } = parsed.data

    const apiKey = request.header('X-API-Key')
    if (!apiKey) {
      return badRequestResponse(400, { reason: 'Missing API key' })
    }

    try {
      const quote = await this.quoteUseCase.createQuote(
        amount,
        crypto_currency,
        network,
        payment_method,
        target_currency,
        apiKey,
      )
      return quote
    }
    catch (error) {
      if (error instanceof Error) {
        return badRequestResponse(400, { reason: error.message })
      }
      this.setStatus(500)
      return { expiration_time: 0, quote_id: 'error', value: 0 }
    }
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
  ): Promise<QuoteResponse> {
    const parsed = reverseQuoteRequestSchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }
    const { crypto_currency, network, payment_method, source_amount, target_currency } = parsed.data

    const apiKey = request.header('X-API-Key')
    if (!apiKey) {
      return badRequestResponse(400, { reason: 'Missing API key' })
    }

    try {
      const quote = await this.quoteUseCase.createReverseQuote(
        crypto_currency,
        network,
        payment_method,
        source_amount,
        target_currency,
        apiKey,
      )
      return quote
    }
    catch (error) {
      if (error instanceof Error) {
        return badRequestResponse(400, { reason: error.message })
      }
      this.setStatus(500)
      return { expiration_time: 0, quote_id: 'error', value: 0 }
    }
  }
}
