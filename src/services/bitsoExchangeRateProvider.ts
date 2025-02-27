import { CryptoCurrency, TargetCurrency } from "@prisma/client";
import { IExchangeRateProvider } from "../interfaces";

export class BitsoExchangeRateProvider implements IExchangeRateProvider {
  async getExchangeRate(
    sourceCurrency: CryptoCurrency,
    targetCurrency: TargetCurrency,
  ): Promise<number> {
    const book = `usd_${targetCurrency.toLowerCase()}`;
    const url = `https://api-stage.bitso.com/api/v3/ticker?book=${book}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      if (!data.success) {
        throw new Error(`Bitso API error: ${data.error || "Unknown error"}`);
      }

      const lastPrice = parseFloat(data.payload.last);
      if (isNaN(lastPrice)) {
        throw new Error("Invalid ticker data received from Bitso.");
      }

      return 1 / lastPrice;
    } catch (error) {
      console.error("Error fetching ticker data from Bitso:", error);
      throw error;
    }
  }
}
