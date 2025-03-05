// src/controllers/QuoteController.ts
import {
  Controller,
  Post,
  Route,
  Body,
  Security,
  Response,
  SuccessResponse,
  Request,
} from "tsoa";
import { Country, CryptoCurrency } from "@prisma/client";
import {
  BlockchainNetwork,
  PaymentMethod,
  TargetCurrency,
} from ".prisma/client";
import { Request as RequestExpress } from "express";
import { inject, injectable } from "inversify";
import { IExchangeRateProvider, IPartnerService } from "../interfaces";
import { TYPES } from "../types";
import { IDatabaseClientProvider } from "../interfaces/IDatabaseClientProvider";

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

@Route("quote")
@Security("ApiKeyAuth")
export class QuoteController extends Controller {
  constructor(
    @inject(TYPES.IExchangeRateProvider)
    private exchangeRateProvider: IExchangeRateProvider,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPartnerService) private partnerService: IPartnerService,
  ) {
    super();
  }

  /**
   * Retrieves a quote to convert a given fiat amount into USDC.
   *
   * @param requestBody - The details needed to generate a quote (amount, currency, etc.).
   * @returns A quote containing the USDC `value`, `expiration_time`, and `quote_id`.
   */
  @Post()
  @SuccessResponse("200", "Quote response")
  @Response("400", "Bad Request")
  @Response("401", "Unauthorized")
  @Response("404", "Not Found")
  @Response("500", "Internal Server Error")
  public async getQuote(
    @Body() requestBody: QuoteRequest,
    @Request() request: RequestExpress,
  ): Promise<QuoteResponse> {
    const {
      amount,
      target_currency: targetCurrency,
      payment_method: paymentMethod,
      crypto_currency: cryptoCurrency,
      network,
    } = requestBody;

    // Retrieve partner information from the API key
    const partner = await this.partnerService.getPartnerFromRequest(request);

    // Set the expiration date to one hour from now
    const expirationDate = new Date(Date.now() + 3_600_000);

    // Use the injected exchange rate provider to obtain the exchange rate
    let exchangeRate = await this.exchangeRateProvider.getExchangeRate(
      cryptoCurrency,
      targetCurrency,
    );

    // add bridge fee to the exchange rate
    const BRIDGE_FEE = 0.002;
    exchangeRate = exchangeRate * (1 + BRIDGE_FEE);

    // add nequi fee to the amount
    const NEQUI_FEE = 1354.22;
    const amountWithNequiFee = amount + NEQUI_FEE;

    // Calculate the source amount based on the provided amount and exchange rate
    const sourceAmount = Number((exchangeRate * amountWithNequiFee).toFixed(2));

    const prismaClient = await this.dbClientProvider.getClient();
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
        partnerId: partner.id,
      },
    });

    return {
      value: quote.sourceAmount,
      expiration_time: expirationDate.getTime(),
      quote_id: quote.id,
    };
  }
}
