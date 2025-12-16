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

import { QuoteUseCase } from '../../../../modules/quotes/application/quoteUseCase'

const buildPaymentService = (overrides?: Partial<IPaymentService>): IPaymentService => ({
  banks: [],
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

describe('QuoteUseCase', () => {
  let dbProvider: IDatabaseClientProvider
  let paymentServiceFactory: IPaymentServiceFactory
  let exchangeProviderFactory: IExchangeProviderFactory
  let secretManager: ISecretManager
  let quoteUseCase: QuoteUseCase
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
    quoteUseCase = new QuoteUseCase(dbProvider, paymentServiceFactory, exchangeProviderFactory, secretManager)
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
    const limitedService = buildPaymentService({ MAX_USER_AMOUNT_PER_TRANSACTION: 50 })
    ;(paymentServiceFactory.getPaymentService as jest.Mock).mockReturnValue(limitedService)

    await expect(quoteUseCase.createQuote({
      amount: 100,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      paymentMethod: PaymentMethod.BREB,
      targetCurrency: TargetCurrency.COP,
    })).rejects.toThrow('The maximum allowed amount for COP is 50 COP')
  })

  it('enforces minimum amount per transaction', async () => {
    const brebService = buildPaymentService({ MAX_USER_AMOUNT_PER_TRANSACTION: 10_000, MIN_USER_AMOUNT_PER_TRANSACTION: 5_000 })
    ;(paymentServiceFactory.getPaymentService as jest.Mock).mockReturnValue(brebService)

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

    const restrictiveService = buildPaymentService({ MAX_USER_AMOUNT_PER_TRANSACTION: 1 })
    ;(paymentServiceFactory.getPaymentService as jest.Mock).mockReturnValue(restrictiveService)

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
    const paymentService = buildPaymentService({ fixedFee: 0 })
    ;(paymentServiceFactory.getPaymentService as jest.Mock).mockReturnValue(paymentService)
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
})
