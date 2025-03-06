import { CryptoCurrency, Partner, TargetCurrency } from "@prisma/client";
import { Request } from "express";

export interface IPaymentService {
  sendPayment({
    account,
    value,
    id,
  }: {
    account: string;
    value: number;
    id: string;
  }): Promise<{
    success: boolean;
  }>;
}

export interface IExchangeRateProvider {
  getExchangeRate(
    sourceCurrency: CryptoCurrency,
    targetCurrency: TargetCurrency,
  ): Promise<number>;
}

// The enum and interface definitions:
export enum QueueName {
  STELLAR_TRANSACTIONS = "stellar-transactions",
}

export interface IQueueHandler {
  postMessage(queueName: QueueName, message: Record<string, any>): void;
  subscribeToQueue(
    queueName: QueueName,
    callback: (message: Record<string, any>) => void,
  ): void;
}

export interface IPartnerService {
  getPartnerFromRequest(request: Request): Promise<Partner>;
}

export interface ILogger {
  info(message: string, ...optionalParams: any[]): void;
  warn(message: string, ...optionalParams: any[]): void;
  error(message: string, ...optionalParams: any[]): void;
}

export interface ISlackNotifier {
  sendMessage(message: string): Promise<void>;
}
