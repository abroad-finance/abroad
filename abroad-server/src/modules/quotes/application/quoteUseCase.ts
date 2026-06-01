// src/useCases/quoteUseCase.ts
import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  Partner,
  TargetCurrency,
} from '.prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'
import { IPaymentService } from '../../payments/application/contracts/IPaymentService'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { SupportedPaymentMethod } from '../../payments/application/supportedPaymentMethods'
import { IExchangeProviderFactory } from '../../treasury/application/contracts/IExchangeProviderFactory'
import { ICorridorPricingProvider } from './contracts/ICorridorPricingProvider'

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

// Parameter object for createQuote
interface CreateQuoteParams {
  amount: number
  cryptoCurrency: CryptoCurrency
  network: BlockchainNetwork
  partner?: Partner
  paymentMethod: SupportedPaymentMethod
  targetCurrency: TargetCurrency
}

// Parameter object for createReverseQuote
interface CreateReverseQuoteParams {
  cryptoCurrency: CryptoCurrency
  network: BlockchainNetwork
  partner?: Partner
  paymentMethod: SupportedPaymentMethod
  sourceAmountInput: number
  targetCurrency: TargetCurrency
}

@injectable()
export class QuoteUseCase implements IQuoteUseCase {
  private readonly EXPIRATION_DURATION_MS = 3_600_000 // one hour

  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPaymentServiceFactory)
    private paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IExchangeProviderFactory)
    private exchangeProviderFactory: IExchangeProviderFactory,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ICorridorPricingProvider)
    private corridorPricingProvider: ICorridorPricingProvider,
  ) { }

  public async createQuote(params: CreateQuoteParams): Promise<QuoteResponse> {
    const { amount, cryptoCurrency, network, partner, paymentMethod, targetCurrency } = params

    const targetAmount = this.normalizeTargetAmount(amount, targetCurrency)
    const expirationDate = this.getExpirationDate()

    const pricing = await this.corridorPricingProvider.getPricing({
      blockchain: network,
      cryptoCurrency,
      targetCurrency,
    })

    const exchangeRateProvider = this.exchangeProviderFactory.getExchangeProviderForCapability?.({
      targetCurrency,
    }) ?? this.exchangeProviderFactory.getExchangeProvider(targetCurrency)
    const exchangeRate = await exchangeRateProvider.getExchangeRate({
      sourceCurrency: cryptoCurrency, targetAmount, targetCurrency,
    })
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new Error('Invalid exchange rate received')
    }
    const exchangeRateWithFee = this.applyExchangeFee(exchangeRate, pricing.exchangeFeePct)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
    this.ensurePaymentServiceIsEnabled(paymentService, paymentMethod)

    this.ensureAmountWithinLimits(targetAmount, pricing, targetCurrency)

    const sourceAmount = this.calculateSourceAmount(targetAmount, exchangeRateWithFee, pricing.fixedFee)

    const prismaClient = await this.dbClientProvider.getClient()

    const sepPartnerId = await this.secretManager.getSecret('STELLAR_SEP_PARTNER_ID')
    const sepPartner = await prismaClient.partner.findFirst({
      where: { id: sepPartnerId },
    })

    let quotePartner: Partner
    if (partner) {
      quotePartner = partner
    }
    else if (sepPartner) {
      quotePartner = sepPartner
    }
    else {
      throw new Error('No partner information available for quote creation')
    }

    const quote = await prismaClient.quote.create({
      data: {
        country: Country.CO,
        cryptoCurrency,
        expirationDate,
        network,
        partnerId: quotePartner.id,
        paymentMethod,
        sourceAmount,
        targetAmount,
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

    const pricing = await this.corridorPricingProvider.getPricing({
      blockchain: network,
      cryptoCurrency,
      targetCurrency,
    })

    const exchangeRateProvider = this.exchangeProviderFactory.getExchangeProviderForCapability?.({
      targetCurrency,
    }) ?? this.exchangeProviderFactory.getExchangeProvider(targetCurrency)
    const exchangeRate = await exchangeRateProvider.getExchangeRate({ sourceAmount: sourceAmountInput, sourceCurrency: cryptoCurrency, targetCurrency })
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new Error('Invalid exchange rate received')
    }
    const exchangeRateWithFee = this.applyExchangeFee(exchangeRate, pricing.exchangeFeePct)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
    this.ensurePaymentServiceIsEnabled(paymentService, paymentMethod)
    const targetAmount = this.calculateTargetAmount(
      sourceAmountInput,
      exchangeRateWithFee,
      pricing.fixedFee,
      targetCurrency,
    )

    this.ensureAmountWithinLimits(targetAmount, pricing, targetCurrency)

    const prismaClient = await this.dbClientProvider.getClient()
    const sepPartnerId = await this.secretManager.getSecret('STELLAR_SEP_PARTNER_ID')
    const sepPartner = await prismaClient.partner.findFirst({
      where: { id: sepPartnerId },
    })

    let quotePartner: Partner
    if (partner) {
      quotePartner = partner
    }
    else if (sepPartner) {
      quotePartner = sepPartner
    }
    else {
      throw new Error('No partner information available for quote creation')
    }

    const quote = await prismaClient.quote.create({
      data: {
        country: Country.CO,
        cryptoCurrency,
        expirationDate,
        network,
        partnerId: quotePartner.id,
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

  private applyExchangeFee(rate: number, exchangePercentageFee: number): number {
    return rate * (1 + exchangePercentageFee)
  }

  private calculateSourceAmount(amount: number, exchangeRate: number, fixedFee: number): number {
    const amountWithFee = amount + fixedFee
    const result = exchangeRate * amountWithFee
    return Number(result.toFixed(2))
  }

  private calculateTargetAmount(
    sourceAmount: number,
    exchangeRate: number,
    fixedFee: number,
    targetCurrency: TargetCurrency,
  ): number {
    const result = sourceAmount / exchangeRate - fixedFee
    return this.normalizeTargetAmount(result, targetCurrency)
  }

  private ensureAmountWithinLimits(
    amount: number,
    limits: { maxAmount: null | number, minAmount: null | number },
    targetCurrency: TargetCurrency,
  ): void {
    if (limits.minAmount !== null && amount < limits.minAmount) {
      throw new Error(`The minimum allowed amount for ${targetCurrency} is ${limits.minAmount} ${targetCurrency}`)
    }

    if (limits.maxAmount !== null && amount > limits.maxAmount) {
      throw new Error(`The maximum allowed amount for ${targetCurrency} is ${limits.maxAmount} ${targetCurrency}`)
    }
  }

  private ensurePaymentServiceIsEnabled(paymentService: IPaymentService, paymentMethod: SupportedPaymentMethod): void {
    if (!paymentService.isEnabled) {
      throw new Error(`Payment method ${paymentMethod} is currently unavailable`)
    }
  }

  private getExpirationDate(): Date {
    return new Date(Date.now() + this.EXPIRATION_DURATION_MS)
  }

  private getFractionDigitsForCurrency(targetCurrency: TargetCurrency): number {
    switch (targetCurrency) {
      case TargetCurrency.COP:
        return 0
      case TargetCurrency.BRL:
      default:
        return 2
    }
  }

  private normalizeTargetAmount(amount: number, targetCurrency: TargetCurrency): number {
    const fractionDigits = this.getFractionDigitsForCurrency(targetCurrency)
    return Number(amount.toFixed(fractionDigits))
  }
}
