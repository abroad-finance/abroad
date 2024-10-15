import { Body, Controller, Post, Route, Tags, Example, Header } from "tsoa";

interface QuoteResponse {
  value: number;
  expiration_time: number;
  quote_id: string;
}

interface AcceptQuoteRequest {
  quote_id: string;
}

interface AcceptQuoteResponse {
  transactionId: string;
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
  account_number: string;
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
   * @param apiKey The API key used for authentication.
   *
   * @returns A response object with the calculated value and the expiration time of the quote.
   */
  @Post("/")
  @Example<QuoteResponse>({
    value: 500,
    expiration_time: 1697041800,
    quote_id: "123456",
  })
  public async createQuote(
    @Body() body: QuoteRequest,
    @Header("X-API-KEY") apiKey?: string
  ): Promise<QuoteResponse> {
    // Verify the API key
    if (!apiKey || apiKey !== process.env.EXPECTED_API_KEY) {
      throw new Error("Invalid or missing API key");
    }

    try {
      // Generate random values for the quote
      const minCryptoValue = 10;
      const maxCryptoValue = 1000;
      const randomValue = Math.random() * (maxCryptoValue - minCryptoValue) + minCryptoValue;

      // Generate a quote ID and expiration time
      const quoteId = `${Math.random().toString(36).substring(2, 8)}`;
      const expirationTime = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now

      return {
        value: parseFloat(randomValue.toFixed(2)),
        expiration_time: expirationTime,
        quote_id: quoteId,
      };
    } catch (error) {
      console.error("Error generating quote:", error);
      throw new Error("Failed to create a quote");
    }
  }

  /**
   * Accepts a quote based on the provided quote_id and generates a transaction ID.
   * 
   * @param body The request payload containing the quote ID.
   * @param apiKey The API key used for authentication.
   * 
   * @returns A response object with the generated transaction ID.
   */
  @Post("/accept")
  @Example<AcceptQuoteResponse>({
    transactionId: "txn_abc123",
  })
  public async acceptQuote(
    @Body() body: AcceptQuoteRequest,
    @Header("X-API-KEY") apiKey?: string
  ): Promise<AcceptQuoteResponse> {
    // Verify the API key
    if (!apiKey || apiKey !== process.env.EXPECTED_API_KEY) {
      throw new Error("Invalid or missing API key");
    }

    // Extract the quote ID from the request
    const { quote_id } = body;

    // Simulate checking if the quote exists or is valid (you can implement this logic as needed)
    if (!quote_id) {
      throw new Error("Invalid quote ID");
    }

    // Generate a transaction ID
    const transactionId = `txn_${Math.random().toString(36).substring(2, 8)}`;

    return {
      transactionId,
    };
  }
}
