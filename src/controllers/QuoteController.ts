import { Body, Controller, Post, Route, Tags, Example } from "tsoa";
import axios from "axios";

interface QuoteResponse {
  value: number;
  expiration_time: number;
  quote_id: string;
}

enum Currency {
  "COP" = "COP",
}

enum PaymentMethod {
  "NEQUI" = "NEQUI",
}

enum CryptoCurrency {
  "USDC" = "USDC",
}

enum Network {
  "STELLAR" = "STELLAR",
}

interface QuoteRequest {
  amount: number;
  target_currency: Currency;
  payment_method: PaymentMethod;
  crypto_currency: CryptoCurrency;
  network: Network;
}

@Route("quote")
@Tags("Quote")
export class QuoteController extends Controller {
  /**
   * Creates a quote for a cryptocurrency transaction based on the provided fiat amount and target currency.
   * This endpoint calculates the equivalent cryptocurrency value in USD for a specified amount of fiat currency (COP).
   * The response includes the quote value and expiration time.
   *
   * @param body The request payload containing details about the transaction, including fiat amount, target currency, payment method, crypto currency, and network.
   *
   * @returns A response object with the calculated value and the expiration time of the quote.
   */
  @Post("/")
  @Example<QuoteResponse>({
    value: 500,
    expiration_time: 1697041800,
    quote_id: "123456",
  })
  public async createQuote(@Body() body: QuoteRequest): Promise<QuoteResponse> {
    const { amount, target_currency, crypto_currency } = body;

    try {
      // Get the current exchange rate from CoinGecko for COP to USD
      const fiatRateResponse = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=${target_currency}`
      );

      // Convert the fiat amount (COP) to USD
      const fiatToUsdRate =
        fiatRateResponse.data["tether"][target_currency.toLowerCase()];
      const usdAmount = amount / fiatToUsdRate;

      // Get the cryptocurrency rate in USD
      const cryptoRateResponse = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${crypto_currency.toLowerCase()}&vs_currencies=usd`
      );

      // Convert USD amount to the target cryptocurrency
      const usdToCryptoRate =
        cryptoRateResponse.data[crypto_currency.toLowerCase()]["usd"];
      const cryptoAmount = usdAmount / usdToCryptoRate;

      // Generate a quote ID and expiration time
      const quoteId = `${Math.random().toString(36).substring(2, 8)}`;
      const expirationTime = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now

      return {
        value: cryptoAmount,
        expiration_time: expirationTime,
        quote_id: quoteId,
      };
    } catch (error) {
      console.error("Error fetching price data:", error);
      throw new Error("Failed to create a quote");
    }
  }
}
