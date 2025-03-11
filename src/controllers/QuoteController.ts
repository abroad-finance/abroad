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
  TsoaResponse,
  Res,
} from "tsoa";
import { Country, CryptoCurrency } from "@prisma/client";
import {
  BlockchainNetwork,
  PaymentMethod,
  TargetCurrency,
} from ".prisma/client";
import { Request as RequestExpress } from "express";
import { inject } from "inversify";
import { IExchangeRateProvider, IPartnerService } from "../interfaces";
import { TYPES } from "../types";
import { IDatabaseClientProvider } from "../interfaces/IDatabaseClientProvider";

// Request interfaces
interface QuoteRequest {
  amount: number;
  target_currency: TargetCurrency;
  payment_method: PaymentMethod;
  crypto_currency: CryptoCurrency;
  network: BlockchainNetwork;
}

interface ReverseQuoteRequest {
  source_amount: number;
  target_currency: TargetCurrency;
  payment_method: PaymentMethod;
  crypto_currency: CryptoCurrency;
  network: BlockchainNetwork;
}

// Response interface
interface QuoteResponse {
  value: number;
  expiration_time: number;
  quote_id: string;
}

const MAX_COP_AMOUNT = 500_000;
const BRIDGE_FEE = 0.002;
const NEQUI_FEE = 1354.22;
const EXPIRATION_DURATION_MS = 3_600_000; // one hour

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

  // Helper: Calculate expiration date (one hour from now)
  private getExpirationDate(): Date {
    return new Date(Date.now() + EXPIRATION_DURATION_MS);
  }

  // Helper: Adjust exchange rate by applying the bridge fee
  private applyBridgeFee(rate: number): number {
    return rate * (1 + BRIDGE_FEE);
  }

  // Helper: Calculate crypto amount based on fiat amount and fees
  private calculateSourceAmount(amount: number, exchangeRate: number): number {
    const amountWithFee = amount + NEQUI_FEE;
    const result = exchangeRate * amountWithFee;
    return Number(result.toFixed(2));
  }

  // Helper: Reverse conversion calculation
  private calculateTargetAmount(
    sourceAmount: number,
    exchangeRate: number,
  ): number {
    const result = sourceAmount / exchangeRate - NEQUI_FEE;
    return Number(result.toFixed(2));
  }

  /**
   * Retrieves a quote to convert a given fiat amount into crypto.
   */
  @Post()
  @SuccessResponse("200", "Quote response")
  @Response("400", "Bad Request")
  public async getQuote(
    @Body() requestBody: QuoteRequest,
    @Request() request: RequestExpress,
    @Res() maxLimitResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<QuoteResponse> {
    try {
      const {
        amount,
        target_currency: targetCurrency,
        payment_method: paymentMethod,
        crypto_currency: cryptoCurrency,
        network,
      } = requestBody;

      // Enforce COP limit
      if (targetCurrency === TargetCurrency.COP && amount > MAX_COP_AMOUNT) {
        return maxLimitResponse(400, {
          reason: `The maximum allowed amount for COP is ${MAX_COP_AMOUNT}`,
        });
      }

      const partner = await this.partnerService.getPartnerFromRequest(request);
      const expirationDate = this.getExpirationDate();

      // Get and adjust exchange rate
      let exchangeRate = await this.exchangeRateProvider.getExchangeRate(
        cryptoCurrency,
        targetCurrency,
      );
      if (!exchangeRate || isNaN(exchangeRate)) {
        return maxLimitResponse(400, {
          reason: "Invalid exchange rate received",
        });
      }
      exchangeRate = this.applyBridgeFee(exchangeRate);

      const sourceAmount = this.calculateSourceAmount(amount, exchangeRate);

      const prismaClient = await this.dbClientProvider.getClient();
      const quote = await prismaClient.quote.create({
        data: {
          country: Country.CO,
          cryptoCurrency,
          expirationDate,
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
    } catch (error) {
      this.setStatus(500);
      // Log error as needed
      return { value: 0, expiration_time: 0, quote_id: "error" };
    }
  }

  /**
   * Retrieves a reverse quote: given the crypto amount the user sends,
   * it returns the fiat amount (target amount) they would receive.
   */
  @Post("/reverse")
  @SuccessResponse("200", "Reverse quote response")
  @Response("400", "Bad Request")
  public async getReverseQuote(
    @Body() requestBody: ReverseQuoteRequest,
    @Request() request: RequestExpress,
    @Res() maxLimitResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<QuoteResponse> {
    try {
      const {
        source_amount: sourceAmountInput,
        target_currency: targetCurrency,
        payment_method: paymentMethod,
        crypto_currency: cryptoCurrency,
        network,
      } = requestBody;

      const partner = await this.partnerService.getPartnerFromRequest(request);
      const expirationDate = this.getExpirationDate();

      // Get and adjust exchange rate
      let exchangeRate = await this.exchangeRateProvider.getExchangeRate(
        cryptoCurrency,
        targetCurrency,
      );
      if (!exchangeRate || isNaN(exchangeRate)) {
        return maxLimitResponse(400, {
          reason: "Invalid exchange rate received",
        });
      }
      exchangeRate = this.applyBridgeFee(exchangeRate);

      const targetAmount = this.calculateTargetAmount(
        sourceAmountInput,
        exchangeRate,
      );

      // Enforce COP limit for reverse quote
      if (
        targetCurrency === TargetCurrency.COP &&
        targetAmount > MAX_COP_AMOUNT
      ) {
        return maxLimitResponse(400, {
          reason: `The maximum allowed amount for COP is ${MAX_COP_AMOUNT}`,
        });
      }

      const prismaClient = await this.dbClientProvider.getClient();
      const quote = await prismaClient.quote.create({
        data: {
          country: Country.CO,
          cryptoCurrency,
          expirationDate,
          network,
          paymentMethod,
          targetCurrency,
          targetAmount,
          sourceAmount: sourceAmountInput,
          partnerId: partner.id,
        },
      });

      return {
        value: quote.targetAmount,
        expiration_time: expirationDate.getTime(),
        quote_id: quote.id,
      };
    } catch (error) {
      this.setStatus(500);
      // Log error as needed
      return { value: 0, expiration_time: 0, quote_id: "error" };
    }
  }
}
