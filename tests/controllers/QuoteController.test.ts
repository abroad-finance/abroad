import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '.prisma/client'
import { Request as RequestExpress } from 'express'

import { QuoteController } from '../../src/controllers/QuoteController'
import { IQuoteUseCase, QuoteResponse } from '../../src/useCases/quoteUseCase'

describe('QuoteController', () => {
  let quoteUseCaseMock: IQuoteUseCase
  let quoteController: QuoteController
  let request: Partial<RequestExpress>
  // This mock simulates the TSOA bad request response function.
  let badRequestResponse: jest.Mock

  beforeEach(() => {
    quoteUseCaseMock = {
      createQuote: jest.fn(),
      createReverseQuote: jest.fn(),
    } as unknown as IQuoteUseCase

    quoteController = new QuoteController(quoteUseCaseMock)
    request = {
      header: jest.fn(),
    }
    badRequestResponse = jest.fn()
  })

  describe('getQuote', () => {
    const validBody = {
      amount: 100,
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: PaymentMethod.NEQUI,
      target_currency: TargetCurrency.COP,
    }

    it('should return a quote when input is valid', async () => {
      // Arrange: Set the API key and expected quote.
      ; (request.header as jest.Mock).mockReturnValue('dummy-api-key')
      const expectedQuote: QuoteResponse = { expiration_time: 123, quote_id: 'abc', value: 999 }
        ; (quoteUseCaseMock.createQuote as jest.Mock).mockResolvedValue(expectedQuote)

      // Act: Call getQuote.
      const result = await quoteController.getQuote(validBody, request as RequestExpress, badRequestResponse)

      // Assert: Ensure the quote is returned and the use case was called with the correct parameters.
      expect(result).toEqual(expectedQuote)
      expect(quoteUseCaseMock.createQuote).toHaveBeenCalledWith({
        amount: validBody.amount,
        apiKey: 'dummy-api-key',
        cryptoCurrency: validBody.crypto_currency,
        network: validBody.network,
        paymentMethod: validBody.payment_method,
        targetCurrency: validBody.target_currency,
      })
    })

    it('should return a bad request when API key is missing', async () => {
      ; (request.header as jest.Mock).mockReturnValue(null)

      await quoteController.getQuote(validBody, request as RequestExpress, badRequestResponse)
      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: 'Missing API key' })
    })

    it('should return a bad request when input validation fails', async () => {
      const invalidBody = { ...validBody, amount: -100 }
        ; (request.header as jest.Mock).mockReturnValue('dummy-api-key')

      await quoteController.getQuote(invalidBody, request as RequestExpress, badRequestResponse)
      // We expect the badRequestResponse to be called with a reason string coming from Zod.
      expect(badRequestResponse).toHaveBeenCalledWith(400, expect.objectContaining({ reason: expect.any(String) }))
    })

    it('should return a bad request when createQuote throws an error', async () => {
      ; (request.header as jest.Mock).mockReturnValue('dummy-api-key')
      const errorMessage = 'Error occurred'
        ; (quoteUseCaseMock.createQuote as jest.Mock).mockRejectedValue(new Error(errorMessage))

      await quoteController.getQuote(validBody, request as RequestExpress, badRequestResponse)
      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: errorMessage })
    })
  })

  describe('getReverseQuote', () => {
    const validBody = {
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: PaymentMethod.NEQUI,
      source_amount: 50,
      target_currency: TargetCurrency.COP,
    }

    it('should return a reverse quote when input is valid', async () => {
      ; (request.header as jest.Mock).mockReturnValue('dummy-api-key')
      const expectedQuote: QuoteResponse = { expiration_time: 321, quote_id: 'def', value: 555 }
        ; (quoteUseCaseMock.createReverseQuote as jest.Mock).mockResolvedValue(expectedQuote)

      const result = await quoteController.getReverseQuote(validBody, request as RequestExpress, badRequestResponse)
      expect(result).toEqual(expectedQuote)
      expect(quoteUseCaseMock.createReverseQuote).toHaveBeenCalledWith({
        apiKey: 'dummy-api-key',
        cryptoCurrency: validBody.crypto_currency,
        network: validBody.network,
        paymentMethod: validBody.payment_method,
        sourceAmountInput: validBody.source_amount,
        targetCurrency: validBody.target_currency,
      })
    })

    it('should return a bad request when API key is missing', async () => {
      ; (request.header as jest.Mock).mockReturnValue(null)

      await quoteController.getReverseQuote(validBody, request as RequestExpress, badRequestResponse)
      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: 'Missing API key' })
    })

    it('should return a bad request when input validation fails', async () => {
      const invalidBody = { ...validBody, source_amount: -50 }
        ; (request.header as jest.Mock).mockReturnValue('dummy-api-key')

      await quoteController.getReverseQuote(invalidBody, request as RequestExpress, badRequestResponse)
      expect(badRequestResponse).toHaveBeenCalledWith(400, expect.objectContaining({ reason: expect.any(String) }))
    })

    it('should return a bad request when createReverseQuote throws an error', async () => {
      ; (request.header as jest.Mock).mockReturnValue('dummy-api-key')
      const errorMessage = 'Reverse quote error'
        ; (quoteUseCaseMock.createReverseQuote as jest.Mock).mockRejectedValue(new Error(errorMessage))

      await quoteController.getReverseQuote(validBody, request as RequestExpress, badRequestResponse)
      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: errorMessage })
    })
  })
})
