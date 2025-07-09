/**
 * tests/controllers/QuoteController.test.ts
 *
 * Unit tests for QuoteController.
 */
import 'reflect-metadata' // required by Inversify/Tsoa decorators

import type { Request as RequestExpress } from 'express'

import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '.prisma/client'

import type { IQuoteUseCase, QuoteResponse } from '../../useCases/quoteUseCase'

import { QuoteController } from '../../controllers/QuoteController'

describe('QuoteController', () => {
  let mockQuoteUseCase: jest.Mocked<IQuoteUseCase>
  let controller: QuoteController
  let req: RequestExpress
  let badRequest: jest.Mock

  const partner = { id: 'partner-1' }

  beforeEach(() => {
    mockQuoteUseCase = {
      createQuote: jest.fn(),
      createReverseQuote: jest.fn(),
    } as unknown as jest.Mocked<IQuoteUseCase>

    controller = new QuoteController(mockQuoteUseCase)
    req = { user: partner } as unknown as RequestExpress
    badRequest = jest.fn((code: number, body: { reason: string }) => body)
  })

  /* ------------------------------------------------------------------
     *  getQuote
     * ------------------------------------------------------------------ */
  describe('getQuote', () => {
    const validQuoteBody = {
      amount: 100,
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: PaymentMethod.NEQUI,
      target_currency: TargetCurrency.COP,
    }

    it('returns a quote for a valid request', async () => {
      const quote: QuoteResponse = {
        expiration_time: Date.now() + 60_000,
        quote_id: 'q-123',
        value: 500,
      }
      mockQuoteUseCase.createQuote.mockResolvedValueOnce(quote)

      const result = await controller.getQuote(validQuoteBody, req, badRequest)

      expect(result).toEqual(quote)
      expect(badRequest).not.toHaveBeenCalled()
      expect(mockQuoteUseCase.createQuote).toHaveBeenCalledWith({
        amount: 100,
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        partner,
        paymentMethod: PaymentMethod.NEQUI,
        targetCurrency: TargetCurrency.COP,
      })
    })

    it('returns 400 when the body fails Zod validation', async () => {
      const invalidBody = { ...validQuoteBody, amount: -10 }

      const result = await controller.getQuote(invalidBody, req, badRequest)

      expect(badRequest).toHaveBeenCalledWith(
        400,
        expect.objectContaining({ reason: expect.any(String) }),
      )
      expect(result).toEqual(
        expect.objectContaining({ reason: expect.any(String) }),
      )
      expect(mockQuoteUseCase.createQuote).not.toHaveBeenCalled()
    })

    it('maps business errors from createQuote to 400', async () => {
      mockQuoteUseCase.createQuote.mockRejectedValueOnce(new Error('boom'))

      const result = await controller.getQuote(validQuoteBody, req, badRequest)

      expect(badRequest).toHaveBeenCalledWith(400, { reason: 'boom' })
      expect(result).toEqual({ reason: 'boom' })
    })

    it('returns a 500 fallback on non-Error rejections', async () => {
      const setStatusSpy = jest.spyOn(controller, 'setStatus')
      mockQuoteUseCase.createQuote.mockRejectedValueOnce('unknown')

      const result = await controller.getQuote(validQuoteBody, req, badRequest)

      expect(setStatusSpy).toHaveBeenCalledWith(500)
      expect(result).toEqual({ expiration_time: 0, quote_id: 'error', value: 0 })
    })
  })

  /* ------------------------------------------------------------------
     *  getReverseQuote
     * ------------------------------------------------------------------ */
  describe('getReverseQuote', () => {
    const validReverseBody = {
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: PaymentMethod.NEQUI,
      source_amount: 150,
      target_currency: TargetCurrency.COP,
    }

    it('returns a reverse quote for a valid request', async () => {
      const quote: QuoteResponse = {
        expiration_time: Date.now() + 60_000,
        quote_id: 'rq-123',
        value: 120,
      }
      mockQuoteUseCase.createReverseQuote.mockResolvedValueOnce(quote)

      const result = await controller.getReverseQuote(
        validReverseBody,
        req,
        badRequest,
      )

      expect(result).toEqual(quote)
      expect(badRequest).not.toHaveBeenCalled()
      expect(mockQuoteUseCase.createReverseQuote).toHaveBeenCalledWith({
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        partner,
        paymentMethod: PaymentMethod.NEQUI,
        sourceAmountInput: 150,
        targetCurrency: TargetCurrency.COP,
      })
    })

    it('returns 400 when reverse-quote body is invalid', async () => {
      const invalidBody = { ...validReverseBody, source_amount: -1 }

      const result = await controller.getReverseQuote(
        invalidBody,
        req,
        badRequest,
      )

      expect(badRequest).toHaveBeenCalledWith(
        400,
        expect.objectContaining({ reason: expect.any(String) }),
      )
      expect(result).toEqual(
        expect.objectContaining({ reason: expect.any(String) }),
      )
      expect(mockQuoteUseCase.createReverseQuote).not.toHaveBeenCalled()
    })
  })
})
