/* eslint-disable @typescript-eslint/no-explicit-any */
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '.prisma/client'

// QuoteController.test.ts
import { QuoteController } from '../../src/controllers/QuoteController'

describe('QuoteController', () => {
  let quoteController: QuoteController
  let mockExchangeRateProvider: { getExchangeRate: jest.Mock }
  let mockDbClientProvider: { getClient: jest.Mock }
  let mockPartnerService: { getPartnerFromRequest: jest.Mock }
  let mockPrismaClient: { quote: { create: jest.Mock } }

  beforeEach(() => {
    // Create mock functions for each dependency
    mockExchangeRateProvider = { getExchangeRate: jest.fn() }

    mockPrismaClient = {
      quote: { create: jest.fn() },
    }

    mockDbClientProvider = {
      getClient: jest.fn().mockResolvedValue(mockPrismaClient),
    }

    mockPartnerService = { getPartnerFromRequest: jest.fn() }

    // Instantiate controller with mocked dependencies
    quoteController = new QuoteController(
      mockExchangeRateProvider,
      mockDbClientProvider,
      mockPartnerService,
    )
  })

  describe('getQuote', () => {
    it('should return a valid quote response for a valid request', async () => {
      // Arrange
      const fakePartner = { id: 'partner-id' }
      mockPartnerService.getPartnerFromRequest.mockResolvedValue(fakePartner)
      // Return a valid exchange rate. For example, 100 will be adjusted to 100 * (1 + 0.002) = 100.2.
      mockExchangeRateProvider.getExchangeRate.mockResolvedValue(100)

      // Given amount is 100 and NEQUI_FEE is 1354.22, the calculation is:
      //   amountWithFee = 100 + 1354.22 = 1454.22
      //   sourceAmount = 1454.22 * 100.2, rounded to two decimals.
      const computedSourceAmount = Number((1454.22 * 100.2).toFixed(2))

      const fakeQuote = {
        id: 'quote-id-123',
        sourceAmount: computedSourceAmount,
      }
      mockPrismaClient.quote.create.mockResolvedValue(fakeQuote)

      const requestBody = {
        amount: 100,
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        target_currency: TargetCurrency.COP,
      }

      const req = {} as any // dummy express request
      const maxLimitResponse = jest.fn()

      // Act
      const response = await quoteController.getQuote(
        requestBody,
        req,
        maxLimitResponse,
      )

      // Assert
      expect(response).toEqual({
        expiration_time: expect.any(Number),
        quote_id: 'quote-id-123',
        value: computedSourceAmount,
      })
      // Ensure the exchange rate provider was called correctly
      expect(mockExchangeRateProvider.getExchangeRate).toHaveBeenCalledWith(
        requestBody.crypto_currency,
        requestBody.target_currency,
      )
    })

    it('should return error response when COP amount exceeds the max limit', async () => {
      // Arrange: Amount above MAX_COP_AMOUNT (500000) when target currency is COP.
      const requestBody = {
        amount: 600000,
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        target_currency: TargetCurrency.COP,
      }
      const req = {} as any
      // Use a maxLimitResponse mock that returns the error payload.
      const maxLimitResponse = jest.fn((code, error) => error)

      // Act
      const response = await quoteController.getQuote(
        requestBody,
        req,
        maxLimitResponse,
      )

      // Assert
      expect(maxLimitResponse).toHaveBeenCalledWith(400, {
        reason: 'The maximum allowed amount for COP is 500000',
      })
      expect(response).toEqual({
        reason: 'The maximum allowed amount for COP is 500000',
      })
    })

    it('should return error response when the exchange rate is invalid', async () => {
      // Arrange
      const fakePartner = { id: 'partner-id' }
      mockPartnerService.getPartnerFromRequest.mockResolvedValue(fakePartner)
      // Simulate an invalid exchange rate (null)
      mockExchangeRateProvider.getExchangeRate.mockResolvedValue(null)

      const requestBody = {
        amount: 100,
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        target_currency: TargetCurrency.COP,
      }
      const req = {} as any
      const maxLimitResponse = jest.fn((code, error) => error)

      // Act
      const response = await quoteController.getQuote(
        requestBody,
        req,
        maxLimitResponse,
      )

      // Assert
      expect(maxLimitResponse).toHaveBeenCalledWith(400, {
        reason: 'Invalid exchange rate received',
      })
      expect(response).toEqual({ reason: 'Invalid exchange rate received' })
    })

    it('should return a generic error response when an exception occurs', async () => {
      // Arrange: Force an exception by making partnerService throw an error.
      mockPartnerService.getPartnerFromRequest.mockRejectedValue(
        new Error('Test error'),
      )
      const requestBody = {
        amount: 100,
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        target_currency: TargetCurrency.COP,
      }
      const req = {} as any
      const maxLimitResponse = jest.fn()

      // Act
      const response = await quoteController.getQuote(
        requestBody,
        req,
        maxLimitResponse,
      )

      // Assert: When an exception occurs, the controller returns a fixed error quote.
      expect(response).toEqual({
        expiration_time: 0,
        quote_id: 'error',
        value: 0,
      })
    })
  })

  describe('getReverseQuote', () => {
    it('should return a valid reverse quote response for a valid request', async () => {
      // Arrange
      const fakePartner = { id: 'partner-id' }
      mockPartnerService.getPartnerFromRequest.mockResolvedValue(fakePartner)
      // Return a valid exchange rate which will be adjusted.
      mockExchangeRateProvider.getExchangeRate.mockResolvedValue(100)
      // After applying the bridge fee, the exchange rate becomes 100 * 1.002 = 100.2.
      // For a given source_amount, calculate targetAmount:
      //   targetAmount = (source_amount / 100.2) - 1354.22, rounded to two decimals.
      const sourceAmountInput = 300000
      const computedTargetAmount = Number(
        (sourceAmountInput / 100.2 - 1354.22).toFixed(2),
      )

      const fakeQuote = {
        id: 'quote-reverse-id',
        targetAmount: computedTargetAmount,
      }
      mockPrismaClient.quote.create.mockResolvedValue(fakeQuote)

      const requestBody = {
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        source_amount: sourceAmountInput,
        target_currency: TargetCurrency.COP,
      }
      const req = {} as any
      const maxLimitResponse = jest.fn()

      // Act
      const response = await quoteController.getReverseQuote(
        requestBody,
        req,
        maxLimitResponse,
      )

      // Assert
      expect(response).toEqual({
        expiration_time: expect.any(Number),
        quote_id: 'quote-reverse-id',
        value: computedTargetAmount,
      })
    })

    it('should return error response when the exchange rate is invalid in reverse quote', async () => {
      // Arrange
      const fakePartner = { id: 'partner-id' }
      mockPartnerService.getPartnerFromRequest.mockResolvedValue(fakePartner)
      // Simulate an invalid exchange rate (NaN)
      mockExchangeRateProvider.getExchangeRate.mockResolvedValue(NaN)

      const requestBody = {
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        source_amount: 300000,
        target_currency: TargetCurrency.COP,
      }
      const req = {} as any
      const maxLimitResponse = jest.fn((code, error) => error)

      // Act
      const response = await quoteController.getReverseQuote(
        requestBody,
        req,
        maxLimitResponse,
      )

      // Assert
      expect(maxLimitResponse).toHaveBeenCalledWith(400, {
        reason: 'Invalid exchange rate received',
      })
      expect(response).toEqual({ reason: 'Invalid exchange rate received' })
    })

    it('should return error response when COP limit is exceeded in reverse quote', async () => {
      // Arrange: For target currency COP, if computed targetAmount exceeds 500000, the method should error.
      const fakePartner = { id: 'partner-id' }
      mockPartnerService.getPartnerFromRequest.mockResolvedValue(fakePartner)
      mockExchangeRateProvider.getExchangeRate.mockResolvedValue(100) // adjusted to 100.2

      // To force targetAmount > 500000:
      // targetAmount = (source_amount / 100.2) - 1354.22 > 500000  =>
      // source_amount > (500000 + 1354.22) * 100.2
      const requiredSourceAmount = (500000 + 1354.22) * 100.2 + 1

      const requestBody = {
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        source_amount: requiredSourceAmount,
        target_currency: TargetCurrency.COP,
      }
      const req = {} as any
      const maxLimitResponse = jest.fn((code, error) => error)

      // Act
      const response = await quoteController.getReverseQuote(
        requestBody,
        req,
        maxLimitResponse,
      )

      // Assert
      expect(maxLimitResponse).toHaveBeenCalledWith(400, {
        reason: 'The maximum allowed amount for COP is 500000',
      })
      expect(response).toEqual({
        reason: 'The maximum allowed amount for COP is 500000',
      })
    })

    it('should return a generic error response when an exception occurs in reverse quote', async () => {
      // Arrange: Force an exception in getReverseQuote by making partnerService throw an error.
      mockPartnerService.getPartnerFromRequest.mockRejectedValue(
        new Error('Test error'),
      )
      const requestBody = {
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        source_amount: 300000,
        target_currency: TargetCurrency.COP,
      }
      const req = {} as any
      const maxLimitResponse = jest.fn()

      // Act
      const response = await quoteController.getReverseQuote(
        requestBody,
        req,
        maxLimitResponse,
      )

      // Assert
      expect(response).toEqual({
        expiration_time: 0,
        quote_id: 'error',
        value: 0,
      })
    })
  })
})
