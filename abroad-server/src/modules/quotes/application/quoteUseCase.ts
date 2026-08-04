// src/useCases/quoteUseCase.ts
import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  CustomerFeeType,
  Partner,
  Prisma,
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
import { QuoteRequestError } from './errors/QuoteRequestError'

// Interface for QuoteUseCase
export interface IQuoteUseCase {
  createQuote(params: CreateQuoteParams): Promise<QuoteResponse>
  createReverseQuote(params: CreateReverseQuoteParams): Promise<QuoteResponse>
}

export interface QuoteFeeResponse {
  amount: string
  currency: CryptoCurrency
  type: 'combined' | 'fixed' | 'none' | 'percentage'
}

export interface QuoteResponse {
  expiration_time: number
  fee: QuoteFeeResponse
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

type CustomerFeeSnapshot = {
  amount: string
  currency: CryptoCurrency
  databaseType: CustomerFeeType
  wireType: QuoteFeeResponse['type']
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
      throw new QuoteRequestError(
        'quote_unavailable',
        'A quote is temporarily unavailable',
        true,
        500,
      )
    }
    const exchangeRateWithFee = this.applyExchangeFee(exchangeRate, pricing.exchangeFeePct)

    const paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
    this.ensurePaymentServiceIsEnabled(paymentService, paymentMethod)

    this.ensureAmountWithinLimits(targetAmount, pricing, targetCurrency)

    const sourceAmount = this.calculateSourceAmount(targetAmount, exchangeRateWithFee, pricing.fixedFee)
    const fee = this.buildCustomerFeeSnapshot({
      cryptoCurrency,
      exchangeFeePct: pricing.exchangeFeePct,
      fixedFee: pricing.fixedFee,
      rawExchangeRate: exchangeRate,
      sourceAmount,
      targetAmount,
    })

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
        baseRateSourcePerTarget: this.decimalString(exchangeRate, 18),
        country: this.countryFor(targetCurrency),
        cryptoCurrency,
        customerFeeSourceAmount: fee.amount,
        customerFeeSourceCurrency: fee.currency,
        customerFeeType: fee.databaseType,
        exchangeFeePct: this.decimalString(pricing.exchangeFeePct, 12),
        expirationDate,
        fixedFeeTargetAmount: this.decimalString(pricing.fixedFee, 18),
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
      fee: {
        amount: fee.amount,
        currency: fee.currency,
        type: fee.wireType,
      },
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
      throw new QuoteRequestError(
        'quote_unavailable',
        'A quote is temporarily unavailable',
        true,
        500,
      )
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
    const fee = this.buildCustomerFeeSnapshot({
      cryptoCurrency,
      exchangeFeePct: pricing.exchangeFeePct,
      fixedFee: pricing.fixedFee,
      rawExchangeRate: exchangeRate,
      sourceAmount: sourceAmountInput,
      targetAmount,
    })

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
        baseRateSourcePerTarget: this.decimalString(exchangeRate, 18),
        country: this.countryFor(targetCurrency),
        cryptoCurrency,
        customerFeeSourceAmount: fee.amount,
        customerFeeSourceCurrency: fee.currency,
        customerFeeType: fee.databaseType,
        exchangeFeePct: this.decimalString(pricing.exchangeFeePct, 12),
        expirationDate,
        fixedFeeTargetAmount: this.decimalString(pricing.fixedFee, 18),
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
      fee: {
        amount: fee.amount,
        currency: fee.currency,
        type: fee.wireType,
      },
      quote_id: quote.id,
      value: quote.targetAmount,
    }
  }

  private applyExchangeFee(rate: number, exchangePercentageFee: number): number {
    return rate * (1 + exchangePercentageFee)
  }

  private buildCustomerFeeSnapshot(params: {
    cryptoCurrency: CryptoCurrency
    exchangeFeePct: number
    fixedFee: number
    rawExchangeRate: number
    sourceAmount: number
    targetAmount: number
  }): CustomerFeeSnapshot {
    const {
      cryptoCurrency,
      exchangeFeePct,
      fixedFee,
      rawExchangeRate,
      sourceAmount,
      targetAmount,
    } = params
    const chargedSource = new Prisma.Decimal(String(sourceAmount))
    const baseSource = new Prisma.Decimal(String(rawExchangeRate))
      .times(new Prisma.Decimal(String(targetAmount)))
    const calculatedFee = chargedSource.minus(baseSource)
    const amount = calculatedFee.isNegative()
      ? new Prisma.Decimal(0)
      : calculatedFee
    const hasFixedFee = fixedFee > 0
    const hasPercentageFee = exchangeFeePct > 0
    const databaseType = hasFixedFee && hasPercentageFee
      ? CustomerFeeType.COMBINED
      : hasFixedFee
        ? CustomerFeeType.FIXED
        : hasPercentageFee
          ? CustomerFeeType.PERCENTAGE
          : CustomerFeeType.NONE
    const wireType = databaseType === CustomerFeeType.COMBINED
      ? 'combined'
      : databaseType === CustomerFeeType.FIXED
        ? 'fixed'
        : databaseType === CustomerFeeType.PERCENTAGE
          ? 'percentage'
          : 'none'
    return {
      amount: amount.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(),
      currency: cryptoCurrency,
      databaseType,
      wireType,
    }
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

  private countryFor(targetCurrency: TargetCurrency): Country {
    return targetCurrency === TargetCurrency.BRL ? Country.BR : Country.CO
  }

  private decimalString(value: number, decimalPlaces: number): string {
    return new Prisma.Decimal(String(value))
      .toDecimalPlaces(decimalPlaces, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed()
  }

  private ensureAmountWithinLimits(
    amount: number,
    limits: { maxAmount: null | number, minAmount: null | number },
    targetCurrency: TargetCurrency,
  ): void {
    if (limits.minAmount !== null && amount < limits.minAmount) {
      throw new QuoteRequestError(
        'minimum',
        `The minimum allowed amount for ${targetCurrency} is ${limits.minAmount} ${targetCurrency}`,
        false,
        400,
      )
    }

    if (limits.maxAmount !== null && amount > limits.maxAmount) {
      throw new QuoteRequestError(
        'maximum',
        `The maximum allowed amount for ${targetCurrency} is ${limits.maxAmount} ${targetCurrency}`,
        false,
        400,
      )
    }
  }

  private ensurePaymentServiceIsEnabled(paymentService: IPaymentService, paymentMethod: SupportedPaymentMethod): void {
    if (!paymentService.isEnabled) {
      throw new QuoteRequestError(
        'corridor_unavailable',
        `Payment method ${paymentMethod} is currently unavailable`,
        false,
        400,
      )
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
