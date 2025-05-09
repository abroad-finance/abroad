// src/useCases/quoteUseCase.ts
import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  Partner,
  PaymentMethod,
  TargetCurrency,
} from '.prisma/client'
import { inject, injectable } from 'inversify'

import { IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IExchangeProvider } from '../interfaces/IExchangeProvider'
import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { TYPES } from '../types'

// Parameter object for createQuote
export interface CreateQuoteParams {
  amount: number
  cryptoCurrency: CryptoCurrency
  network: BlockchainNetwork
  partner: Partner
  paymentMethod: PaymentMethod
  targetCurrency: TargetCurrency
}

// Parameter object for createReverseQuote
export interface CreateReverseQuoteParams {
  cryptoCurrency: CryptoCurrency
  network: BlockchainNetwork
  partner: Partner
  paymentMethod: PaymentMethod
  sourceAmountInput: number
  targetCurrency: TargetCurrency
}

// Interface for QuoteUseCase
export interface IQuoteUseCase {
  createQuote(params: CreateQuoteParams): Promise<QuoteResponse>
  createReverseQuote(params: CreateReverseQuoteParams): Promise<QuoteResponse>
}

// Response interface remains unchanged
export interface QuoteResponse {
  expiration_time: number
  quote_id: string
  value: number
}

@injectable()
export class QuoteUseCase implements IQuoteUseCase {
  private readonly EXPIRATION_DURATION_MS = 3_600_000 // one hour

  constructor(
    @inject(TYPES.IExchangeProvider)
    private exchangeRateProvider: IExchangeProvider,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPartnerService)
    private partnerService: IPartnerService,
    @inject(TYPES.IPaymentServiceFactory)
    private paymentServiceFactory: IPaymentServiceFactory,
  ) { }

  public async createQuote(params: CreateQuoteParams): Promise<QuoteResponse> {
    const { amount, cryptoCurrency, network, partner, paymentMethod, targetCurrency } = params

    const expirationDate = this.getExpirationDate()

    const exchangeRate = await this.exchangeRateProvider.getExchangeRate({
      sourceCurrency: cryptoCurrency, targetCurrency,
    })
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new Error('Invalid exchange rate received')
    }
    const exchangeRateWithFee = this.applyExchangeFee(exchangeRate)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)

    // Enforce max user amount
    if (amount > paymentService.MAX_USER_AMOUNT_PER_TRANSACTION) {
      throw new Error(`The maximum allowed amount for ${targetCurrency} is ${paymentService.MAX_USER_AMOUNT_PER_TRANSACTION} ${targetCurrency}`)
    }

    const sourceAmount = this.calculateSourceAmount(amount, exchangeRateWithFee, paymentService.fixedFee)

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

  public async createReverseQuote(params: CreateReverseQuoteParams): Promise<QuoteResponse> {
    const { cryptoCurrency, network, partner, paymentMethod, sourceAmountInput, targetCurrency } = params

    const expirationDate = this.getExpirationDate()

    const exchangeRate = await this.exchangeRateProvider.getExchangeRate({ sourceCurrency: cryptoCurrency, targetCurrency })
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new Error('Invalid exchange rate received')
    }
    const exchangeRateWithFee = this.applyExchangeFee(exchangeRate)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
    const targetAmount = this.calculateTargetAmount(sourceAmountInput, exchangeRateWithFee, paymentService.fixedFee)

    // Enforce max user amount
    if (targetAmount > paymentService.MAX_USER_AMOUNT_PER_TRANSACTION) {
      throw new Error(`The maximum allowed amount for ${targetCurrency} is ${paymentService.MAX_USER_AMOUNT_PER_TRANSACTION} ${targetCurrency}`)
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

  private applyExchangeFee(rate: number): number {
    return rate * (1 + this.exchangeRateProvider.exchangePercentageFee)
  }

  // TODO: Add percentage fee calculation when available
  private calculateSourceAmount(amount: number, exchangeRate: number, fixedFee: number): number {
    const amountWithFee = amount + fixedFee
    const result = exchangeRate * amountWithFee
    return Number(result.toFixed(2))
  }

  private calculateTargetAmount(sourceAmount: number, exchangeRate: number, fixedFee: number): number {
    const result = sourceAmount / exchangeRate - fixedFee
    return Number(result.toFixed(2))
  }

  private getExpirationDate(): Date {
    return new Date(Date.now() + this.EXPIRATION_DURATION_MS)
  }
}
