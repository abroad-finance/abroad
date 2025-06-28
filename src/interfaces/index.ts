// src/interfaces/index.ts
import { Partner } from '@prisma/client'

// The enum and interface definitions:
export enum QueueName {
  BINANCE_BALANCE_UPDATED = 'binance-balance-updated',
  PAYMENT_SENT = 'payment-sent',
  RECEIVED_CRYPTO_TRANSACTION = 'received-crypto-transaction',
}

export interface ILogger {
  error(message: string, ...optionalParams: unknown[]): void
  info(message: string, ...optionalParams: unknown[]): void
  warn(message: string, ...optionalParams: unknown[]): void
}

export interface IPartnerService {
  getPartnerFromApiKey(apiKey?: string): Promise<Partner>
  getPartnerFromBearerToken(token: string): Promise<Partner>
  getPartnerFromSepJwt(token: string): Promise<Partner>
}

export interface IQueueHandler {
  postMessage(
    queueName: QueueName,
    message: Record<string, boolean | number | string>,
  ): Promise<void>
  subscribeToQueue(
    queueName: QueueName,
    callback: (message: Record<string, boolean | number | string>) => void,
  ): Promise<void>
}

export interface ISlackNotifier {
  sendMessage(message: string): Promise<void>
}

export * from './IWebhookNotifier'

export * from './IAuthService'
export * from './IWalletHandlerFactory'
export * from './queueSchema'
