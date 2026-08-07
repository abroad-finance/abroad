/**
 * tests/controllers/QuoteController.test.ts
 *
 * Unit tests for QuoteController.
 */
import 'reflect-metadata' // required by Inversify/Tsoa decorators

import type { Request as RequestExpress } from 'express'

import {
  BlockchainNetwork,
  CryptoCurrency,
  Partner,
  PaymentMethod,
  TargetCurrency,
} from '.prisma/client'

import type { ILogger } from '../../../../../core/logging/types'
import type { IPartnerService } from '../../../../../modules/partners/application/contracts/IPartnerService'
import type { IQuoteUseCase, QuoteResponse } from '../../../../../modules/quotes/application/quoteUseCase'

import { QuoteRequestError } from '../../../../../modules/quotes/application/errors/QuoteRequestError'
import { QuoteController } from '../../../../../modules/quotes/interfaces/http/QuoteController'

describe('QuoteController', () => {
  let mockQuoteUseCase: jest.Mocked<IQuoteUseCase>
  let mockPartnerService: jest.Mocked<IPartnerService>
  let mockLogger: jest.Mocked<ILogger>
  let controller: QuoteController
  let req: RequestExpress
  let badRequest: jest.Mock
  let internalServerError: jest.Mock
  let unauthorized: jest.Mock

  const partner = { id: 'partner-1' }

  beforeEach(() => {
    mockQuoteUseCase = {
      createQuote: jest.fn(),
      createReverseQuote: jest.fn(),
    } as unknown as jest.Mocked<IQuoteUseCase>

    mockPartnerService = {
      authenticateBearerToken: jest.fn(),
      getPartnerFromApiKey: jest.fn(),
      getPartnerFromClientDomain: jest.fn(),
    } as unknown as jest.Mocked<IPartnerService>

    mockLogger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }

    controller = new QuoteController(mockQuoteUseCase, mockPartnerService, mockLogger)
    req = { user: partner } as unknown as RequestExpress
    badRequest = jest.fn((code: number, body: { reason: string }) => body)
    internalServerError = jest.fn((code: number, body: { reason: string }) => body)
    unauthorized = jest.fn((code: number, body: { reason: string }) => body)
  })

  /* ------------------------------------------------------------------
     *  getQuote
     * ------------------------------------------------------------------ */
  describe('getQuote', () => {
    const validQuoteBody = {
      amount: 100,
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: PaymentMethod.BREB,
      target_currency: TargetCurrency.COP,
    }

    it('returns a quote for a valid request', async () => {
      const quote: QuoteResponse = {
        expiration_time: Date.now() + 60_000,
        fee: { amount: '1.25', currency: CryptoCurrency.USDC, type: 'combined' },
        quote_id: 'q-123',
        value: 500,
      }
      mockQuoteUseCase.createQuote.mockResolvedValueOnce(quote)

      const result = await controller.getQuote(validQuoteBody, req, badRequest, unauthorized, internalServerError)

      expect(result).toEqual(quote)
      expect(badRequest).not.toHaveBeenCalled()
      expect(mockQuoteUseCase.createQuote).toHaveBeenCalledWith({
        amount: 100,
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        partner,
        paymentMethod: PaymentMethod.BREB,
        targetCurrency: TargetCurrency.COP,
      })
    })

    it('returns 400 when the body fails Zod validation', async () => {
      const invalidBody = { ...validQuoteBody, amount: -10 }

      const result = await controller.getQuote(invalidBody, req, badRequest, unauthorized, internalServerError)

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
      mockQuoteUseCase.createQuote.mockRejectedValueOnce(new QuoteRequestError(
        'minimum',
        'The minimum allowed amount for COP is 5,000 COP',
        false,
        400,
      ))

      const result = await controller.getQuote(validQuoteBody, req, badRequest, unauthorized, internalServerError)

      expect(badRequest).toHaveBeenCalledWith(400, {
        code: 'minimum',
        reason: 'The minimum allowed amount for COP is 5,000 COP',
        retryable: false,
      })
      expect(result).toEqual({
        code: 'minimum',
        reason: 'The minimum allowed amount for COP is 5,000 COP',
        retryable: false,
      })
    })

    it.each([
      ['ordinary errors', new Error('provider response with internal detail')],
      ['non-Error rejections', 'unknown'],
    ])('returns a sanitized 500 fallback on %s', async (_label, rejection) => {
      mockQuoteUseCase.createQuote.mockRejectedValueOnce(rejection)

      const result = await controller.getQuote(validQuoteBody, req, badRequest, unauthorized, internalServerError)

      expect(internalServerError).toHaveBeenCalledWith(500, {
        code: 'server_error',
        reason: 'Unable to create quote',
        retryable: true,
      })
      expect(result).toEqual({
        code: 'server_error',
        reason: 'Unable to create quote',
        retryable: true,
      })
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[QuoteController] quote request failed',
        expect.objectContaining({ errorName: expect.any(String) }),
      )
    })

    it('uses X-API-Key to resolve the partner when no authenticated partner is present', async () => {
      const quote: QuoteResponse = {
        expiration_time: Date.now() + 60_000,
        fee: { amount: '0', currency: CryptoCurrency.USDC, type: 'none' },
        quote_id: 'q-456',
        value: 600,
      }
      const apiPartner = { id: 'partner-2' } as Partner
      const requestWithoutUser = {} as unknown as RequestExpress
      mockPartnerService.getPartnerFromApiKey.mockResolvedValueOnce(apiPartner)
      mockQuoteUseCase.createQuote.mockResolvedValueOnce(quote)

      const result = await controller.getQuote(
        validQuoteBody,
        requestWithoutUser,
        badRequest,
        unauthorized,
        internalServerError,
        'api-key-123',
      )

      expect(result).toEqual(quote)
      expect(mockPartnerService.getPartnerFromApiKey).toHaveBeenCalledWith('api-key-123')
      expect(mockQuoteUseCase.createQuote).toHaveBeenCalledWith({
        amount: 100,
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        partner: apiPartner,
        paymentMethod: PaymentMethod.BREB,
        targetCurrency: TargetCurrency.COP,
      })
    })

    it('returns 401 when the provided X-API-Key is invalid', async () => {
      mockPartnerService.getPartnerFromApiKey.mockRejectedValueOnce(new Error('Invalid API key'))

      const result = await controller.getQuote(
        validQuoteBody,
        {} as unknown as RequestExpress,
        badRequest,
        unauthorized,
        internalServerError,
        'bad-key',
      )

      expect(result).toEqual({
        code: 'authentication_failed',
        reason: 'Invalid API key',
        retryable: false,
      })
      expect(mockQuoteUseCase.createQuote).not.toHaveBeenCalled()
      expect(unauthorized).toHaveBeenCalledWith(401, {
        code: 'authentication_failed',
        reason: 'Invalid API key',
        retryable: false,
      })
      expect(badRequest).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[QuoteController] quote authentication failed',
        { errorName: 'Error', method: 'api_key' },
      )
    })

    it('resolves an optional Bearer token for a client-domain SEP quote', async () => {
      const quote: QuoteResponse = {
        expiration_time: Date.now() + 60_000,
        fee: { amount: '0.5', currency: CryptoCurrency.USDC, type: 'percentage' },
        quote_id: 'q-sep',
        value: 610,
      }
      const sepPartner = { id: 'partner-sep-client' } as Partner
      const bearerRequest = {
        header: jest.fn((name: string) => (
          name === 'Authorization' ? 'Bearer sep-token' : undefined
        )),
      } as unknown as RequestExpress
      mockPartnerService.authenticateBearerToken.mockResolvedValueOnce({
        authenticatedSubject: 'sep:synthetic-subject',
        partner: sepPartner,
        source: 'SEP_24',
      })
      mockQuoteUseCase.createQuote.mockResolvedValueOnce(quote)

      const result = await controller.getQuote(
        validQuoteBody,
        bearerRequest,
        badRequest,
        unauthorized,
        internalServerError,
        undefined,
      )

      expect(result).toEqual(quote)
      expect(mockPartnerService.authenticateBearerToken).toHaveBeenCalledWith('sep-token')
      expect(mockQuoteUseCase.createQuote).toHaveBeenCalledWith(
        expect.objectContaining({ partner: sepPartner }),
      )
    })
  })

  /* ------------------------------------------------------------------
     *  getReverseQuote
     * ------------------------------------------------------------------ */
  describe('getReverseQuote', () => {
    const validReverseBody = {
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: PaymentMethod.PIX,
      source_amount: 150,
      target_currency: TargetCurrency.COP,
    }

    it('returns a reverse quote for a valid request', async () => {
      const quote: QuoteResponse = {
        expiration_time: Date.now() + 60_000,
        fee: { amount: '1', currency: CryptoCurrency.USDC, type: 'fixed' },
        quote_id: 'rq-123',
        value: 120,
      }
      mockQuoteUseCase.createReverseQuote.mockResolvedValueOnce(quote)

      const result = await controller.getReverseQuote(
        validReverseBody,
        req,
        badRequest,
        unauthorized,
        internalServerError,
        undefined,
      )

      expect(result).toEqual(quote)
      expect(badRequest).not.toHaveBeenCalled()
      expect(mockQuoteUseCase.createReverseQuote).toHaveBeenCalledWith({
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        partner,
        paymentMethod: PaymentMethod.PIX,
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
        unauthorized,
        internalServerError,
        undefined,
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
