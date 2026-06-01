import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  Partner,
  PaymentMethod,
  TargetCurrency,
} from '.prisma/client'

import type { IPaymentService } from '../../../../modules/payments/application/contracts/IPaymentService'
import type { IPaymentServiceFactory } from '../../../../modules/payments/application/contracts/IPaymentServiceFactory'
import type { IExchangeProviderFactory } from '../../../../modules/treasury/application/contracts/IExchangeProviderFactory'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import type { CorridorPricing, ICorridorPricingProvider } from '../../../../modules/quotes/application/contracts/ICorridorPricingProvider'

import { CorridorNotConfiguredError } from '../../../../modules/quotes/application/errors/CorridorNotConfiguredError'
import { QuoteUseCase } from '../../../../modules/quotes/application/quoteUseCase'

const buildPaymentService = (overrides?: Partial<IPaymentService>): IPaymentService => ({
  currency: TargetCurrency.COP,
  fixedFee: 1,
  getLiquidity: async () => 0,
  isAsync: false,
  isEnabled: true,
  MAX_TOTAL_AMOUNT_PER_DAY: 0,
  MAX_USER_AMOUNT_PER_DAY: 0,
  MAX_USER_AMOUNT_PER_TRANSACTION: 1_000,
  MAX_USER_TRANSACTIONS_PER_DAY: 0,
  MIN_USER_AMOUNT_PER_TRANSACTION: 0,
  onboardUser: async () => ({ success: true }),
  percentageFee: 0,
  sendPayment: async () => ({ success: true, transactionId: 'tx' }),
  verifyAccount: async () => true,
  ...(overrides ?? {}),
})

const buildCorridorPricing = (overrides?: Partial<CorridorPricing>): CorridorPricing => ({
  exchangeFeePct: 0.01,
  fixedFee: 1,
  maxAmount: null,
  minAmount: null,
  ...(overrides ?? {}),
})

describe('QuoteUseCase', () => {
  let dbProvider: IDatabaseClientProvider
  let paymentServiceFactory: IPaymentServiceFactory
  let exchangeProviderFactory: IExchangeProviderFactory
  let secretManager: ISecretManager
  let quoteUseCase: QuoteUseCase
  let corridorPricingProvider: ICorridorPricingProvider
  const partner: Partner = { id: 'partner-1' } as Partner
  const sepPartner: Partner = { id: 'sep-partner' } as Partner
  const prisma = {
    partner: { findFirst: jest.fn() },
    quote: { create: jest.fn() },
  }

  beforeEach(() => {
    prisma.partner.findFirst.mockResolvedValue(sepPartner)
    prisma.quote.create.mockImplementation(async ({ data }) => ({
      id: 'quote-id',
      ...data,
    }))
    dbProvider = {
      getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
    }
    const paymentService = buildPaymentService()
    paymentServiceFactory = {
      getPaymentService: jest.fn(() => paymentService),
    }
    exchangeProviderFactory = {
      getExchangeProvider: jest.fn(() => ({
        createMarketOrder: jest.fn(),
        exchangePercentageFee: 0.01,
        getExchangeAddress: jest.fn(),
        getExchangeRate: jest.fn(async () => 1.01),
      })),
    }
    secretManager = {
      getSecret: jest.fn(async () => 'sep-partner'),
      getSecrets: jest.fn(),
    }
    corridorPricingProvider = {
      getPricing: jest.fn(async () => buildCorridorPricing()),
    }
    quoteUseCase = new QuoteUseCase(dbProvider, paymentServiceFactory, exchangeProviderFactory, secretManager, corridorPricingProvider)
  })

  it('creates a quote using provided partner and applies fees', async () => {
    const result = await quoteUseCase.createQuote({
      amount: 100,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partner,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })

    expect(exchangeProviderFactory.getExchangeProvider).toHaveBeenCalledWith(TargetCurrency.COP)
    expect(paymentServiceFactory.getPaymentService).toHaveBeenCalledWith(PaymentMethod.BREB)
    expect(prisma.quote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        country: Country.CO,
        partnerId: partner.id,
        targetAmount: 100,
      }),
    })
    expect(result.quote_id).toBe('quote-id')
    expect(result.value).toBeCloseTo(103.03, 2)
  })

  it('throws when exchange rate is invalid', async () => {
    ;(exchangeProviderFactory.getExchangeProvider as jest.Mock).mockReturnValue({
      createMarketOrder: jest.fn(),
      exchangePercentageFee: 0,
      getExchangeAddress: jest.fn(),
      getExchangeRate: jest.fn(async () => NaN),
    })

    await expect(quoteUseCase.createQuote({
      amount: 10,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('Invalid exchange rate received')
  })

  it('enforces max amount per transaction', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(buildCorridorPricing({ maxAmount: 50 }))

    await expect(quoteUseCase.createQuote({
      amount: 100,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('The maximum allowed amount for COP is 50 COP')
  })

  it('enforces minimum amount per transaction', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(buildCorridorPricing({ minAmount: 5_000 }))

    await expect(quoteUseCase.createQuote({
      amount: 4_999,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('The minimum allowed amount for COP is 5000 COP')
  })

  it('requires a partner when none is available from SEP config', async () => {
    prisma.partner.findFirst.mockResolvedValueOnce(null)

    await expect(quoteUseCase.createQuote({
      amount: 10,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('No partner information available for quote creation')
  })

  it('creates reverse quotes and validates max amount', async () => {
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({
      id: 'reverse-1',
      ...data,
    }))

    const result = await quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 50,
      targetCurrency: TargetCurrency.COP,
    })

    expect(result.quote_id).toBe('reverse-1')
    expect(result.value).toBe(48)

    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(buildCorridorPricing({ maxAmount: 1 }))

    await expect(quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 50,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('The maximum allowed amount for COP is 1 COP')
  })

  it('rejects quotes when the payment method is disabled', async () => {
    const disabledService = buildPaymentService({ isEnabled: false })
    ;(paymentServiceFactory.getPaymentService as jest.Mock).mockReturnValue(disabledService)

    await expect(quoteUseCase.createQuote({
      amount: 50,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('Payment method BREB is currently unavailable')

    await expect(quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 25,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('Payment method PIX is currently unavailable')
  })

  it('normalizes COP target amounts to whole numbers when creating quotes', async () => {
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({
      id: 'quote-decimal',
      ...data,
    }))

    await quoteUseCase.createQuote({
      amount: 100.6,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partner,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })

    expect(prisma.quote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetAmount: 101,
      }),
    })
  })

  it('drops fractional digits from COP reverse quotes', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(
      buildCorridorPricing({ exchangeFeePct: 0, fixedFee: 0 }),
    )
    ;(exchangeProviderFactory.getExchangeProvider as jest.Mock).mockReturnValue({
      createMarketOrder: jest.fn(),
      exchangePercentageFee: 0,
      getExchangeAddress: jest.fn(),
      getExchangeRate: jest.fn(async () => 3.789),
    })
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({
      id: 'reverse-precision',
      ...data,
    }))

    const result = await quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 12.34,
      targetCurrency: TargetCurrency.COP,
    })

    expect(prisma.quote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetAmount: 3,
      }),
    })
    expect(result.value).toBe(3)
  })

  it('surfaces invalid exchange rates on reverse quotes', async () => {
    ;(exchangeProviderFactory.getExchangeProvider as jest.Mock).mockReturnValue({
      createMarketOrder: jest.fn(),
      exchangePercentageFee: 0.01,
      getExchangeAddress: jest.fn(),
      getExchangeRate: jest.fn(async () => undefined),
    })

    await expect(quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      sourceAmountInput: 10,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('Invalid exchange rate received')
  })

  it('prefers provided partners over SEP configuration when reversing quotes', async () => {
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({ id: 'partnered-reverse', ...data }))

    const response = await quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partner,
      paymentMethod: PaymentMethod.BREB,
      sourceAmountInput: 80,
      targetCurrency: TargetCurrency.BRL,
    })

    expect(prisma.quote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ partnerId: partner.id, targetCurrency: TargetCurrency.BRL }),
    })
    expect(response.quote_id).toBe('partnered-reverse')
  })

  it('requires configured partners when reversing quotes with SEP unavailable', async () => {
    prisma.partner.findFirst.mockResolvedValueOnce(null)

    await expect(quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 25,
      targetCurrency: TargetCurrency.BRL,
    })).rejects.toThrow('No partner information available for quote creation')
  })

  it('keeps two decimal places for BRL target amounts', async () => {
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({ id: 'brl-quote', ...data }))

    await quoteUseCase.createQuote({
      amount: 123.456,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partner,
      paymentMethod: PaymentMethod.PIX,
      targetCurrency: TargetCurrency.BRL,
    })

    expect(prisma.quote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetAmount: 123.46, targetCurrency: TargetCurrency.BRL }),
    })
  })

  it('falls back to default fraction digits for unexpected currencies', async () => {
    const normalizeTargetAmount = (quoteUseCase as unknown as {
      normalizeTargetAmount: (amount: number, targetCurrency: TargetCurrency) => number
    }).normalizeTargetAmount

    const normalized = normalizeTargetAmount.call(
      quoteUseCase,
      42.987,
      'USD' as unknown as TargetCurrency,
    )

    expect(normalized).toBe(42.99)
  })

  it('prices using corridor exchangeFeePct and fixedFee, not provider constants', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(
      buildCorridorPricing({ exchangeFeePct: 0.1, fixedFee: 5 }),
    )
    // Clean rate so the expected value is exact (no float-rounding boundary).
    ;(exchangeProviderFactory.getExchangeProvider as jest.Mock).mockReturnValue({
      createMarketOrder: jest.fn(),
      exchangePercentageFee: 0.01, // must be ignored in favor of the corridor's 0.1
      getExchangeAddress: jest.fn(),
      getExchangeRate: jest.fn(async () => 2),
    })
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({ id: 'priced', ...data }))

    const result = await quoteUseCase.createQuote({
      amount: 100,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partner,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })

    expect(corridorPricingProvider.getPricing).toHaveBeenCalledWith({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.COP,
    })
    // rate 2 * (1 + 0.1) = 2.2 ; (100 + 5) * 2.2 = 231 exactly.
    // If the provider's 0.01 fee were used instead, the value would be 212.1.
    expect(result.value).toBe(231)
  })

  it('rejects quotes for corridors without an active flow definition (fail-fast)', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockRejectedValue(
      new CorridorNotConfiguredError({
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.COP,
      }),
    )

    await expect(quoteUseCase.createQuote({
      amount: 100,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('No active flow definition for corridor USDC/STELLAR → COP')

    expect(exchangeProviderFactory.getExchangeProvider).not.toHaveBeenCalled()
  })

  it('rejects reverse quotes for corridors without an active flow definition', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockRejectedValue(
      new CorridorNotConfiguredError({
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        targetCurrency: TargetCurrency.COP,
      }),
    )

    await expect(quoteUseCase.createReverseQuote({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.PIX,
      sourceAmountInput: 50,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow(CorridorNotConfiguredError)
  })

  it('applies no limit when corridor min/max are null', async () => {
    ;(corridorPricingProvider.getPricing as jest.Mock).mockResolvedValue(
      buildCorridorPricing({ maxAmount: null, minAmount: null }),
    )
    prisma.quote.create.mockImplementationOnce(async ({ data }) => ({ id: 'no-limit', ...data }))

    const result = await quoteUseCase.createQuote({
      amount: 999_999_999,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partner,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })

    expect(result.quote_id).toBe('no-limit')
  })
})
