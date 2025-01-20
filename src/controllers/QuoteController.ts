// src/controllers/QuoteController.ts
import { Controller, Post, Route, Body, Security, Response, SuccessResponse, Request } from 'tsoa';
import { prismaClient } from '../infrastructure/db';
import { Country, CryptoCurrency, } from '@prisma/client';
import { BlockchainNetwork, PaymentMethod, TargetCurrency } from '.prisma/client';
import { getExchangeValue } from '../services/exchange';

interface QuoteRequest {
    amount: number;
    target_currency: TargetCurrency;
    payment_method: PaymentMethod;
    crypto_currency: CryptoCurrency;
    network: BlockchainNetwork;
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
        @Body() requestBody: QuoteRequest,
        @Request() request: Request
    ): Promise<QuoteResponse> {
        // Get body from request
        const { amount, target_currency: targetCurrency, payment_method: paymentMethod, crypto_currency: cryptoCurrency, network } = requestBody;

        // Get partner id from api key
        const apiKey = request.headers.get('x-api-key');

        if (!apiKey) {
            this.setStatus(401);
            throw new Error('Unauthorized');
        }

        const partner = await prismaClient.partner.findFirst({
            where: {
                apiKey
            }
        })

        if (!partner) {
            this.setStatus(404);
            throw new Error('Partner not found');
        }

        // expiration date equals now + 1 hour
        const expirationDate = new Date(Date.now() + 3600000);

        const sourceAmount = await getExchangeValue(cryptoCurrency, targetCurrency, amount);

        const quote = await prismaClient.quote.create({
            data: {
                country: Country.CO,
                cryptoCurrency,
                expirationDate: expirationDate,
                network,
                paymentMethod,
                targetCurrency,
                targetAmount: amount,
                sourceAmount,
                partnerId: partner.id
            }
        })

        return {
            value: quote.sourceAmount,
            expiration_time: expirationDate.getTime(),
            quote_id: quote.id,
        };
    }
}

