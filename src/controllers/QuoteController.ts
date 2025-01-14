// src/controllers/QuoteController.ts
import { Controller, Post, Route, Body, Security, Response, SuccessResponse } from 'tsoa';

interface QuoteRequest {
    amount: number;
    target_currency: string;
    payment_method: string;
    crypto_currency: string;
    network: string;
}

interface QuoteResponse {
    value: number;
    expiration_time: number;
    quote_id: string;
}

@Route('quote')
@Security('ApiKeyAuth')
export class QuoteController extends Controller {

    /**
   * Retrieves a quote to convert a given fiat amount into USDC. 
   * 
   * @param requestBody - The details needed to generate a quote (amount, currency, etc.).
   * @returns A quote containing the USDC `value`, `expiration_time`, and `quote_id`.
   */
    @Post()
    @SuccessResponse('200', 'Quote response')
    @Response('400', 'Bad Request')
    @Response('401', 'Unauthorized')
    @Response('404', 'Not Found')
    @Response('500', 'Internal Server Error')
    public async getQuote(
        @Body() requestBody: QuoteRequest
    ): Promise<QuoteResponse> {

        // Dummy response
        return {
            value: 12.34,
            expiration_time: 1697041800,
            quote_id: '123456',
        };
    }
}
