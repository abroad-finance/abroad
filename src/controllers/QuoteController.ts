import { BlockchainNetwork, PaymentMethod, TargetCurrency } from '.prisma/client'
import { Country, CryptoCurrency } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
// src/controllers/QuoteController.ts
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

import { IExchangeRateProvider, IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { TYPES } from '../types'

// Request interfaces
interface QuoteRequest {
  amount: number
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: PaymentMethod
  target_currency: TargetCurrency
}

// Response interface
interface QuoteResponse {
  expiration_time: number
  quote_id: string
  value: number
}

interface ReverseQuoteRequest {
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: PaymentMethod
  source_amount: number
  target_currency: TargetCurrency
}

const MAX_COP_AMOUNT = 500_000
const BRIDGE_FEE = 0.002
const NEQUI_FEE = 1354.22
const EXPIRATION_DURATION_MS = 3_600_000 // one hour

@Route('quote')
@Security('ApiKeyAuth')
export class QuoteController extends Controller {
  constructor(
    @inject(TYPES.IExchangeRateProvider)
    private exchangeRateProvider: IExchangeRateProvider,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPartnerService) private partnerService: IPartnerService,
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
    @Res() maxLimitResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<QuoteResponse> {
    try {
      const {
        amount,
        crypto_currency: cryptoCurrency,
        network,
        payment_method: paymentMethod,
        target_currency: targetCurrency,
      } = requestBody

      // Enforce COP limit
      if (targetCurrency === TargetCurrency.COP && amount > MAX_COP_AMOUNT) {
        return maxLimitResponse(400, {
          reason: `The maximum allowed amount for COP is ${MAX_COP_AMOUNT}`,
        })
      }

      const partner = await this.partnerService.getPartnerFromRequest(request)
      const expirationDate = this.getExpirationDate()

      // Get and adjust exchange rate
      let exchangeRate = await this.exchangeRateProvider.getExchangeRate(
        cryptoCurrency,
        targetCurrency,
      )
      if (!exchangeRate || isNaN(exchangeRate)) {
        return maxLimitResponse(400, {
          reason: 'Invalid exchange rate received',
        })
      }
      exchangeRate = this.applyBridgeFee(exchangeRate)

      const sourceAmount = this.calculateSourceAmount(amount, exchangeRate)

      const prismaClient = await this.dbClientProvider.getClient()
      const quote = await prismaClient.quote.create({
        data: {
          country: Country.CO,
          cryptoCurrency,
          expirationDate,
          network,
          partnerId: partner.id,
          paymentMethod,
          sourceAmount,
          targetAmount: amount,
          targetCurrency,
        },
      })

      return {
        expiration_time: expirationDate.getTime(),
        quote_id: quote.id,
        value: quote.sourceAmount,
      }
    }
    catch (error) {
      this.setStatus(500)
      // Log error as needed
      console.error('Error in getQuote:', error)
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
    @Res() maxLimitResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<QuoteResponse> {
    try {
      const {
        crypto_currency: cryptoCurrency,
        network,
        payment_method: paymentMethod,
        source_amount: sourceAmountInput,
        target_currency: targetCurrency,
      } = requestBody

      const partner = await this.partnerService.getPartnerFromRequest(request)
      const expirationDate = this.getExpirationDate()

      // Get and adjust exchange rate
      let exchangeRate = await this.exchangeRateProvider.getExchangeRate(
        cryptoCurrency,
        targetCurrency,
      )
      if (!exchangeRate || isNaN(exchangeRate)) {
        return maxLimitResponse(400, {
          reason: 'Invalid exchange rate received',
        })
      }
      exchangeRate = this.applyBridgeFee(exchangeRate)

      const targetAmount = this.calculateTargetAmount(
        sourceAmountInput,
        exchangeRate,
      )

      // Enforce COP limit for reverse quote
      if (
        targetCurrency === TargetCurrency.COP
        && targetAmount > MAX_COP_AMOUNT
      ) {
        return maxLimitResponse(400, {
          reason: `The maximum allowed amount for COP is ${MAX_COP_AMOUNT}`,
        })
      }

      const prismaClient = await this.dbClientProvider.getClient()
      const quote = await prismaClient.quote.create({
        data: {
          country: Country.CO,
          cryptoCurrency,
          expirationDate,
          network,
          partnerId: partner.id,
          paymentMethod,
          sourceAmount: sourceAmountInput,
          targetAmount,
          targetCurrency,
        },
      })

      return {
        expiration_time: expirationDate.getTime(),
        quote_id: quote.id,
        value: quote.targetAmount,
      }
    }
    catch (error) {
      this.setStatus(500)
      console.error('Error in getReverseQuote:', error)
      return { expiration_time: 0, quote_id: 'error', value: 0 }
    }
  }

  // Helper: Adjust exchange rate by applying the bridge fee
  private applyBridgeFee(rate: number): number {
    return rate * (1 + BRIDGE_FEE)
  }

  // Helper: Calculate crypto amount based on fiat amount and fees
  private calculateSourceAmount(amount: number, exchangeRate: number): number {
    const amountWithFee = amount + NEQUI_FEE
    const result = exchangeRate * amountWithFee
    return Number(result.toFixed(2))
  }

  // Helper: Reverse conversion calculation
  private calculateTargetAmount(
    sourceAmount: number,
    exchangeRate: number,
  ): number {
    const result = sourceAmount / exchangeRate - NEQUI_FEE
    return Number(result.toFixed(2))
  }

  // Helper: Calculate expiration date (one hour from now)
  private getExpirationDate(): Date {
    return new Date(Date.now() + EXPIRATION_DURATION_MS)
  }
}
