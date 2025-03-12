// src/useCases/quoteUseCase.ts
import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  PaymentMethod,
  TargetCurrency,
} from '.prisma/client'
import { inject, injectable } from 'inversify'

import { IExchangeRateProvider, IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { TYPES } from '../types'

// Response interface remains unchanged
export interface QuoteResponse {
  expiration_time: number
  quote_id: string
  value: number
}

@injectable()
export class QuoteUseCase {
  private readonly BRIDGE_FEE = 0.002
  private readonly EXPIRATION_DURATION_MS = 3_600_000 // one hour
  private readonly MAX_COP_AMOUNT = 500_000

  constructor(
    @inject(TYPES.IExchangeRateProvider)
    private exchangeRateProvider: IExchangeRateProvider,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPartnerService)
    private partnerService: IPartnerService,
    @inject(TYPES.IPaymentServiceFactory)
    private paymentServiceFactory: IPaymentServiceFactory,
  ) { }

  public async createQuote(
    amount: number,
    cryptoCurrency: CryptoCurrency,
    network: BlockchainNetwork,
    paymentMethod: PaymentMethod,
    targetCurrency: TargetCurrency,
    apiKey: string,
  ): Promise<QuoteResponse> {
    // Enforce COP limit
    if (targetCurrency === TargetCurrency.COP && amount > this.MAX_COP_AMOUNT) {
      throw new Error(`The maximum allowed amount for COP is ${this.MAX_COP_AMOUNT}`)
    }

    const partner = await this.partnerService.getPartnerFromApiKey(apiKey)
    const expirationDate = this.getExpirationDate()

    const exchangeRate = await this.exchangeRateProvider.getExchangeRate(cryptoCurrency, targetCurrency)
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new Error('Invalid exchange rate received')
    }
    const exchangeRateWithFee = this.applyBridgeFee(exchangeRate)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
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

  public async createReverseQuote(
    cryptoCurrency: CryptoCurrency,
    network: BlockchainNetwork,
    paymentMethod: PaymentMethod,
    sourceAmountInput: number,
    targetCurrency: TargetCurrency,
    apiKey: string,
  ): Promise<QuoteResponse> {
    const partner = await this.partnerService.getPartnerFromApiKey(apiKey)
    const expirationDate = this.getExpirationDate()

    const exchangeRate = await this.exchangeRateProvider.getExchangeRate(cryptoCurrency, targetCurrency)
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new Error('Invalid exchange rate received')
    }
    const exchangeRateWithFee = this.applyBridgeFee(exchangeRate)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
    const targetAmount = this.calculateTargetAmount(sourceAmountInput, exchangeRateWithFee, paymentService.fixedFee)
    // Enforce COP limit for reverse quote
    if (targetCurrency === TargetCurrency.COP && targetAmount > this.MAX_COP_AMOUNT) {
      throw new Error(`The maximum allowed amount for COP is ${this.MAX_COP_AMOUNT}`)
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

  private applyBridgeFee(rate: number): number {
    return rate * (1 + this.BRIDGE_FEE)
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
