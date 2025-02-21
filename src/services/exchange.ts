// src/services/exchange.ts
import { CryptoCurrency, TargetCurrency } from "@prisma/client";

export const getExchangeValue = async (
  sourceCurrency: CryptoCurrency,
  targetCurrency: TargetCurrency,
  amount: number,
): Promise<number> => {
  // Dummy exchange rate
  const exchangeRate = 1 / 4313;
  return amount * exchangeRate;
};
