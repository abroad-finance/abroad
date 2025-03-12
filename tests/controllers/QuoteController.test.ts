import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '.prisma/client'

import { QuoteResponse } from '../useCases/quoteUseCase'
// src/controllers/quoteController.test.ts
import { QuoteController } from './quoteController'

describe('QuoteController', () => {
  let quoteUseCaseMock: {
    createQuote: jest.Mock
    createReverseQuote: jest.Mock
  }
  let quoteController: QuoteController
  let badRequestResponse: jest.Mock
  let requestMock: { header: jest.Mock }

  beforeEach(() => {
    // Create a mock use case with jest.fn for both methods.
    quoteUseCaseMock = {
      createQuote: jest.fn(),
      createReverseQuote: jest.fn(),
    }
    // Instantiate the controller with the mocked use case.
    quoteController = new QuoteController(quoteUseCaseMock)
    // Reset the badRequestResponse function and request header mock.
    badRequestResponse = jest.fn((code: number, payload: { reason: string }) => {
      return payload
    })
    requestMock = {
      header: jest.fn(),
    }
  })

  describe('getQuote', () => {
    const validRequestBody = {
      amount: 100,
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: PaymentMethod.NEQUI,
      target_currency: TargetCurrency.COP,
    }

    it('should return bad request if body validation fails', async () => {
      // Provide an invalid body (e.g., negative amount)
      const invalidRequestBody = {
        amount: -100,
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.NEQUI,
        target_currency: TargetCurrency.COP,
      }
      requestMock.header.mockReturnValue('testApiKey')

      const response = await quoteController.getQuote(
        invalidRequestBody,
        requestMock as any,
        badRequestResponse,
      )

      // The badRequestResponse should be called with a 400 status code and a reason from zod.
      expect(badRequestResponse).toHaveBeenCalledWith(
        400,
        expect.objectContaining({ reason: expect.any(String) }),
      )
      expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
    })

    it('should return bad request if API key is missing', async () => {
      requestMock.header.mockReturnValue(undefined)

      const response = await quoteController.getQuote(
        validRequestBody,
        requestMock as any,
        badRequestResponse,
      )

      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: 'Missing API key' })
      expect(response).toEqual({ reason: 'Missing API key' })
    })

    it('should return bad request if quoteUseCase.createQuote throws an error', async () => {
      requestMock.header.mockReturnValue('testApiKey')
      const errorMessage = 'Test error'
      quoteUseCaseMock.createQuote.mockRejectedValue(new Error(errorMessage))

      const response = await quoteController.getQuote(
        validRequestBody,
        requestMock as any,
        badRequestResponse,
      )

      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: errorMessage })
      expect(response).toEqual({ reason: errorMessage })
    })

    it('should return a valid quote response when successful', async () => {
      requestMock.header.mockReturnValue('testApiKey')
      const fakeQuote: QuoteResponse = {
        expiration_time: Date.now() + 3600000,
        quote_id: 'quoteId',
        value: 202.4,
      }
      quoteUseCaseMock.createQuote.mockResolvedValue(fakeQuote)

      const response = await quoteController.getQuote(
        validRequestBody,
        requestMock as any,
        badRequestResponse,
      )

      // Ensure badRequestResponse is not called in a successful scenario.
      expect(badRequestResponse).not.toHaveBeenCalled()
      expect(response).toEqual(fakeQuote)
    })
  })

  describe('getReverseQuote', () => {
    const validReverseRequestBody = {
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: PaymentMethod.MOVII,
      source_amount: 202.4,
      target_currency: TargetCurrency.COP,
    }

    it('should return bad request if body validation fails', async () => {
      // Provide an invalid reverse quote body (e.g., non-positive source_amount)
      const invalidReverseRequestBody = {
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: PaymentMethod.MOVII,
        source_amount: 0,
        target_currency: TargetCurrency.COP,
      }
      requestMock.header.mockReturnValue('testApiKey')

      const response = await quoteController.getReverseQuote(
        invalidReverseRequestBody,
        requestMock as any,
        badRequestResponse,
      )

      expect(badRequestResponse).toHaveBeenCalledWith(
        400,
        expect.objectContaining({ reason: expect.any(String) }),
      )
      expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
    })

    it('should return bad request if API key is missing', async () => {
      requestMock.header.mockReturnValue(undefined)

      const response = await quoteController.getReverseQuote(
        validReverseRequestBody,
        requestMock as any,
        badRequestResponse,
      )

      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: 'Missing API key' })
      expect(response).toEqual({ reason: 'Missing API key' })
    })

    it('should return bad request if quoteUseCase.createReverseQuote throws an error', async () => {
      requestMock.header.mockReturnValue('testApiKey')
      const errorMessage = 'Reverse error'
      quoteUseCaseMock.createReverseQuote.mockRejectedValue(new Error(errorMessage))

      const response = await quoteController.getReverseQuote(
        validReverseRequestBody,
        requestMock as any,
        badRequestResponse,
      )

      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: errorMessage })
      expect(response).toEqual({ reason: errorMessage })
    })

    it('should return a valid reverse quote response when successful', async () => {
      requestMock.header.mockReturnValue('testApiKey')
      const fakeQuote: QuoteResponse = {
        expiration_time: Date.now() + 3600000,
        quote_id: 'reverseQuoteId',
        value: 100.0,
      }
      quoteUseCaseMock.createReverseQuote.mockResolvedValue(fakeQuote)

      const response = await quoteController.getReverseQuote(
        validReverseRequestBody,
        requestMock as any,
        badRequestResponse,
      )

      expect(badRequestResponse).not.toHaveBeenCalled()
      expect(response).toEqual(fakeQuote)
    })
  })
})
