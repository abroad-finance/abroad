// src/useCases/quoteUseCase.ts
import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  CustomerFeeType,
  FlowDirection,
  Partner,
  Prisma,
  TargetCurrency,
} from '.prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'
import { IFiatDepositServiceFactory } from '../../payments/application/contracts/IFiatDepositServiceFactory'
import { IPaymentService } from '../../payments/application/contracts/IPaymentService'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { SupportedPaymentMethod } from '../../payments/application/supportedPaymentMethods'
import { IExchangeProviderFactory } from '../../treasury/application/contracts/IExchangeProviderFactory'
import { ICorridorPricingProvider } from './contracts/ICorridorPricingProvider'
import { QuoteRequestError } from './errors/QuoteRequestError'

// Interface for QuoteUseCase
export interface IQuoteUseCase {
  createOnrampQuote(params: CreateOnrampQuoteParams): Promise<QuoteResponse>
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

// Parameter object for createOnrampQuote. `fiatAmount` is what the customer
// pays; the quoted crypto they receive is derived from it.
interface CreateOnrampQuoteParams {
  cryptoCurrency: CryptoCurrency
  fiatAmount: number
  network: BlockchainNetwork
  partner?: Partner
  paymentMethod: SupportedPaymentMethod
  targetCurrency: TargetCurrency
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
    @inject(TYPES.IFiatDepositServiceFactory)
    private fiatDepositServiceFactory: IFiatDepositServiceFactory,
  ) { }

  /**
   * Prices a FIAT_TO_CRYPTO corridor: the customer pays `fiatAmount` and
   * receives stablecoin.
   *
   * The stored columns keep their usual denominations — `targetAmount` is the
   * fiat leg and `sourceAmount` the crypto leg — so only who pays which leg
   * changes. The spread runs the other way too: a payout marks the crypto the
   * customer must send up, an onramp marks the crypto they receive down, which
   * is why the fee divides here instead of multiplying.
   */
  public async createOnrampQuote(params: CreateOnrampQuoteParams): Promise<QuoteResponse> {
    const { cryptoCurrency, fiatAmount, network, partner, paymentMethod, targetCurrency } = params

    const targetAmount = this.normalizeTargetAmount(fiatAmount, targetCurrency)
    const expirationDate = this.getExpirationDate()

    const pricing = await this.corridorPricingProvider.getPricing({
      blockchain: network,
      cryptoCurrency,
      direction: FlowDirection.FIAT_TO_CRYPTO,
      targetCurrency,
    })

    const exchangeRateProvider = this.exchangeProviderFactory.getExchangeProviderForCapability?.({
      targetCurrency,
    }) ?? this.exchangeProviderFactory.getExchangeProvider(targetCurrency)
    const exchangeRate = await exchangeRateProvider.getExchangeRate({
      direction: FlowDirection.FIAT_TO_CRYPTO,
      sourceCurrency: cryptoCurrency,
      targetAmount,
      targetCurrency,
    })
    if (!exchangeRate || isNaN(exchangeRate)) {
      throw new QuoteRequestError(
        'quote_unavailable',
        'A quote is temporarily unavailable',
        true,
        500,
      )
    }
    const exchangeRateWithFee = this.applyOnrampExchangeFee(exchangeRate, pricing.exchangeFeePct)

    const depositService = this.fiatDepositServiceFactory.getForCapability({
      paymentMethod,
      targetCurrency,
    })
    if (!depositService.isEnabled) {
      throw new QuoteRequestError(
        'corridor_unavailable',
        `Payment method ${paymentMethod} is currently unavailable`,
        false,
        400,
      )
    }

    this.ensureAmountWithinLimits(targetAmount, pricing, targetCurrency)

    const sourceAmount = this.calculateOnrampSourceAmount(
      targetAmount,
      exchangeRateWithFee,
      pricing.fixedFee,
    )
    if (sourceAmount <= 0) {
      throw new QuoteRequestError(
        'minimum',
        `The amount is too small to cover the ${targetCurrency} fees for this corridor`,
        false,
        400,
      )
    }

    const fee = this.buildOnrampCustomerFeeSnapshot({
      cryptoCurrency,
      exchangeFeePct: pricing.exchangeFeePct,
      fixedFee: pricing.fixedFee,
      rawExchangeRate: exchangeRate,
      sourceAmount,
      targetAmount,
    })

    const prismaClient = await this.dbClientProvider.getClient()
    const quotePartner = await this.resolveQuotePartner(prismaClient, partner)

    const quote = await prismaClient.quote.create({
      data: {
        baseRateSourcePerTarget: this.decimalString(exchangeRate, 18),
        country: this.countryFor(targetCurrency),
        cryptoCurrency,
        customerFeeSourceAmount: fee.amount,
        customerFeeSourceCurrency: fee.currency,
        customerFeeType: fee.databaseType,
        direction: FlowDirection.FIAT_TO_CRYPTO,
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
      // The customer's decision variable is the crypto they will receive.
      value: quote.sourceAmount,
    }
  }

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

    const quotePartner = await this.resolveQuotePartner(prismaClient, partner)

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
    const quotePartner = await this.resolveQuotePartner(prismaClient, partner)

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

  /**
   * The inverse of {@link applyExchangeFee}. A payout marks the crypto the
   * customer must send *up*; an onramp marks the crypto they receive *down*.
   * Dividing keeps the spread we earn identical in both directions.
   */
  private applyOnrampExchangeFee(rate: number, exchangePercentageFee: number): number {
    return rate / (1 + exchangePercentageFee)
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
    const databaseType = this.customerFeeType(fixedFee, exchangeFeePct)
    return {
      amount: amount.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(),
      currency: cryptoCurrency,
      databaseType,
      wireType: this.customerFeeWireType(databaseType),
    }
  }

  /**
   * Fee expressed in the crypto leg, matching the payout snapshot's units: the
   * crypto the customer would have received at the raw desk rate, minus what
   * they actually receive.
   */
  private buildOnrampCustomerFeeSnapshot(params: {
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
    const deliveredSource = new Prisma.Decimal(String(sourceAmount))
    const baseSource = new Prisma.Decimal(String(rawExchangeRate))
      .times(new Prisma.Decimal(String(targetAmount)))
    const calculatedFee = baseSource.minus(deliveredSource)
    const amount = calculatedFee.isNegative()
      ? new Prisma.Decimal(0)
      : calculatedFee

    return {
      amount: amount.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(),
      currency: cryptoCurrency,
      databaseType: this.customerFeeType(fixedFee, exchangeFeePct),
      wireType: this.customerFeeWireType(this.customerFeeType(fixedFee, exchangeFeePct)),
    }
  }

  /**
   * The customer pays `targetAmount` fiat. The fixed fee is taken off the fiat
   * leg before conversion, so what converts is only what we actually put to
   * work buying crypto.
   */
  private calculateOnrampSourceAmount(
    targetAmount: number,
    exchangeRate: number,
    fixedFee: number,
  ): number {
    const convertibleAmount = targetAmount - fixedFee
    if (convertibleAmount <= 0) {
      return 0
    }
    const result = exchangeRate * convertibleAmount
    return Number(result.toFixed(6))
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

  private customerFeeType(fixedFee: number, exchangeFeePct: number): CustomerFeeType {
    const hasFixedFee = fixedFee > 0
    const hasPercentageFee = exchangeFeePct > 0
    if (hasFixedFee && hasPercentageFee) return CustomerFeeType.COMBINED
    if (hasFixedFee) return CustomerFeeType.FIXED
    if (hasPercentageFee) return CustomerFeeType.PERCENTAGE
    return CustomerFeeType.NONE
  }

  private customerFeeWireType(databaseType: CustomerFeeType): QuoteFeeResponse['type'] {
    switch (databaseType) {
      case CustomerFeeType.COMBINED:
        return 'combined'
      case CustomerFeeType.FIXED:
        return 'fixed'
      case CustomerFeeType.NONE:
        return 'none'
      case CustomerFeeType.PERCENTAGE:
        return 'percentage'
    }
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

  private async resolveQuotePartner(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    partner?: Partner,
  ): Promise<Partner> {
    if (partner) {
      return partner
    }
    const sepPartnerId = await this.secretManager.getSecret('STELLAR_SEP_PARTNER_ID')
    const sepPartner = await prismaClient.partner.findFirst({
      where: { id: sepPartnerId },
    })
    if (!sepPartner) {
      throw new Error('No partner information available for quote creation')
    }
    return sepPartner
  }
}
