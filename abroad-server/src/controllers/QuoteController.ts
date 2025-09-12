// src/controllers/QuoteController.ts
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
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { TYPES } from '../types'
import { IQuoteUseCase, QuoteResponse } from '../useCases/quoteUseCase'

// Zod schemas for validating input data.
const quoteRequestSchema = z.object({
  amount: z.number().positive(),
  crypto_currency: z.enum(CryptoCurrency),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(PaymentMethod),
  target_currency: z.enum(TargetCurrency),
})

type QuoteRequest = {
  amount: number
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: PaymentMethod
  target_currency: TargetCurrency
}

const reverseQuoteRequestSchema = z.object({
  crypto_currency: z.enum(CryptoCurrency),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(PaymentMethod),
  source_amount: z.number().positive(),
  target_currency: z.enum(TargetCurrency),
})

type ReverseQuoteRequest = {
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: PaymentMethod
  source_amount: number
  target_currency: TargetCurrency
}

@Route('quote')
export class QuoteController extends Controller {
  constructor(
    @inject(TYPES.QuoteUseCase)
    private quoteUseCase: IQuoteUseCase,
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

    try {
      const quote = await this.quoteUseCase.createQuote({
        amount,
        cryptoCurrency: crypto_currency,
        network,
        partner: request.user,
        paymentMethod: payment_method,
        targetCurrency: target_currency,
      },
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

    try {
      const quote = await this.quoteUseCase.createReverseQuote({
        cryptoCurrency: crypto_currency,
        network,
        partner: request.user,
        paymentMethod: payment_method,
        sourceAmountInput: source_amount,
        targetCurrency: target_currency,
      })
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
