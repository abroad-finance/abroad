import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '.prisma/client'

import { QuoteResponse, QuoteUseCase } from '../../src/useCases/quoteUseCase'

// src/useCases/quoteUseCase.test.ts

describe('QuoteUseCase', () => {
  // Create mocks for all dependencies.
  const exchangeRateProviderMock = {
    getExchangeRate: jest.fn(),
  }
  const dbClientProviderMock = {
    getClient: jest.fn(),
  }
  const partnerServiceMock = {
    getPartnerFromApiKey: jest.fn(),
    getPartnerFromRequest: jest.fn(),
  }
  const paymentServiceFactoryMock = {
    getPaymentService: jest.fn(),
  }

  // Instantiate the use case with our mocks
  let quoteUseCase: QuoteUseCase
  beforeEach(() => {
    jest.clearAllMocks()
    quoteUseCase = new QuoteUseCase(
      exchangeRateProviderMock,
      dbClientProviderMock,
      partnerServiceMock,
      paymentServiceFactoryMock,
    )
  })

  describe('createQuote', () => {
    it('should throw an error when targetCurrency is COP and amount exceeds limit', async () => {
      const amount = 500_001
      await expect(
        quoteUseCase.createQuote(
          amount,
          CryptoCurrency.USDC,
          BlockchainNetwork.STELLAR,
          PaymentMethod.NEQUI,
          TargetCurrency.COP,
          'testApiKey',
        ),
      ).rejects.toThrow('The maximum allowed amount for COP is 500000')
    })

    it('should throw an error if exchange rate is invalid', async () => {
      partnerServiceMock.getPartnerFromApiKey.mockResolvedValue({ id: 'partnerId' })
      exchangeRateProviderMock.getExchangeRate.mockResolvedValue(null) // or NaN

      await expect(
        quoteUseCase.createQuote(
          100,
          CryptoCurrency.USDC,
          BlockchainNetwork.STELLAR,
          PaymentMethod.NEQUI,
          TargetCurrency.COP,
          'testApiKey',
        ),
      ).rejects.toThrow('Invalid exchange rate received')
    })

    it('should create a quote successfully', async () => {
      // Arrange
      partnerServiceMock.getPartnerFromApiKey.mockResolvedValue({ id: 'partnerId' })
      const originalExchangeRate = 2.0
      exchangeRateProviderMock.getExchangeRate.mockResolvedValue(originalExchangeRate)
      const fixedFee = 1.0
      paymentServiceFactoryMock.getPaymentService.mockReturnValue({ fixedFee })
      // Calculate effective exchange rate
      // effectiveRate = originalExchangeRate * (1 + BRIDGE_FEE) = 2.0 * 1.002 = 2.004
      // sourceAmount = (amount + fixedFee) * effectiveRate = (100 + 1) * 2.004 = 101 * 2.004 = 202.404 -> 202.40
      const expectedSourceAmount = 202.40
      const fakeQuote = {
        id: 'quoteId',
        sourceAmount: expectedSourceAmount,
        targetAmount: 100,
      }
      dbClientProviderMock.getClient.mockResolvedValue({
        quote: { create: jest.fn().mockResolvedValue(fakeQuote) },
      })

      // Act
      const response: QuoteResponse = await quoteUseCase.createQuote(
        100,
        CryptoCurrency.USDC,
        BlockchainNetwork.STELLAR,
        PaymentMethod.NEQUI,
        TargetCurrency.COP,
        'testApiKey',
      )

      // Assert
      expect(response).toHaveProperty('expiration_time')
      expect(response).toHaveProperty('quote_id', 'quoteId')
      expect(response).toHaveProperty('value', expectedSourceAmount)
    })
  })

  describe('createReverseQuote', () => {
    it('should throw an error if exchange rate is invalid', async () => {
      partnerServiceMock.getPartnerFromApiKey.mockResolvedValue({ id: 'partnerId' })
      exchangeRateProviderMock.getExchangeRate.mockResolvedValue(null)

      await expect(
        quoteUseCase.createReverseQuote(
          CryptoCurrency.USDC,
          BlockchainNetwork.STELLAR,
          PaymentMethod.MOVII,
          202.40,
          TargetCurrency.COP,
          'testApiKey',
        ),
      ).rejects.toThrow('Invalid exchange rate received')
    })

    it('should throw an error when reverse quote exceeds COP limit', async () => {
      partnerServiceMock.getPartnerFromApiKey.mockResolvedValue({ id: 'partnerId' })
      const originalExchangeRate = 2.0
      exchangeRateProviderMock.getExchangeRate.mockResolvedValue(originalExchangeRate)
      const fixedFee = 1.0
      paymentServiceFactoryMock.getPaymentService.mockReturnValue({ fixedFee })
      // For reverse quote, targetAmount = sourceAmountInput / (originalExchangeRate * 1.002) - fixedFee
      // To exceed COP limit (500,000), we choose sourceAmountInput such that targetAmount > 500000.
      // For example, if sourceAmountInput = 1_000_003, then:
      // effectiveRate = 2.0 * 1.002 = 2.004, and targetAmount = 1_000_003 / 2.004 - 1 ≈ 500,000.5 > 500,000.
      await expect(
        quoteUseCase.createReverseQuote(
          CryptoCurrency.USDC,
          BlockchainNetwork.STELLAR,
          PaymentMethod.MOVII,
          1_000_003,
          TargetCurrency.COP,
          'testApiKey',
        ),
      ).rejects.toThrow('The maximum allowed amount for COP is 500000')
    })

    it('should create a reverse quote successfully', async () => {
      // Arrange
      partnerServiceMock.getPartnerFromApiKey.mockResolvedValue({ id: 'partnerId' })
      const originalExchangeRate = 2.0
      exchangeRateProviderMock.getExchangeRate.mockResolvedValue(originalExchangeRate)
      const fixedFee = 1.0
      paymentServiceFactoryMock.getPaymentService.mockReturnValue({ fixedFee })
      // For reverse quote:
      // effectiveRate = 2.0 * 1.002 = 2.004
      // targetAmount = sourceAmountInput / 2.004 - fixedFee
      // Let sourceAmountInput = 202.40 then targetAmount = 202.40 / 2.004 - 1.0 ≈ 101 - 1.0 = 100.0
      const expectedTargetAmount = 100.0
      const fakeQuote = {
        id: 'reverseQuoteId',
        sourceAmount: 202.40,
        targetAmount: expectedTargetAmount,
      }
      dbClientProviderMock.getClient.mockResolvedValue({
        quote: { create: jest.fn().mockResolvedValue(fakeQuote) },
      })

      // Act
      const response: QuoteResponse = await quoteUseCase.createReverseQuote(
        CryptoCurrency.USDC,
        BlockchainNetwork.STELLAR,
        PaymentMethod.MOVII,
        202.40,
        TargetCurrency.COP,
        'testApiKey',
      )

      // Assert
      expect(response).toHaveProperty('expiration_time')
      expect(response).toHaveProperty('quote_id', 'reverseQuoteId')
      expect(response).toHaveProperty('value', expectedTargetAmount)
    })
  })
})
