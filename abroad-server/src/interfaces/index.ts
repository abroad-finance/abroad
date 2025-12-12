// src/interfaces/index.ts
import { Partner } from '@prisma/client'

import {
  BinanceBalanceUpdatedMessage,
  PaymentSentMessage,
  PaymentStatusUpdatedMessage,
  ReceivedCryptoTransactionMessage,
  UserNotificationMessage,
} from './queueSchema'

// The enum and interface definitions:
export enum QueueName {
  BINANCE_BALANCE_UPDATED = 'binance-balance-updated',
  PAYMENT_SENT = 'payment-sent',
  PAYMENT_STATUS_UPDATED = 'payment-status-updated',
  RECEIVED_CRYPTO_TRANSACTION = 'received-crypto-transaction',
  USER_NOTIFICATION = 'user-notification',
}

export type QueuePayloadByName = {
  [QueueName.BINANCE_BALANCE_UPDATED]: BinanceBalanceUpdatedMessage
  [QueueName.PAYMENT_SENT]: PaymentSentMessage
  [QueueName.PAYMENT_STATUS_UPDATED]: PaymentStatusUpdatedMessage
  [QueueName.RECEIVED_CRYPTO_TRANSACTION]: ReceivedCryptoTransactionMessage
  [QueueName.USER_NOTIFICATION]: UserNotificationMessage
}

export interface ILogger {
  error(message: string, ...optionalParams: unknown[]): void
  info(message: string, ...optionalParams: unknown[]): void
  warn(message: string, ...optionalParams: unknown[]): void
}

export interface IPartnerService {
  getPartnerFromApiKey(apiKey?: string): Promise<Partner>
  getPartnerFromSepJwt(token: string): Promise<Partner>
}

export type QueueSubscriber<Name extends QueueName> = (
  message: QueuePayloadByName[Name],
) => void | Promise<void>

export interface IQueueHandler {
  /** Optional: allow implementations to close subscriptions on shutdown. */
  closeAllSubscriptions?: () => Promise<void>
  postMessage<Name extends QueueName>(
    queueName: Name,
    message: QueuePayloadByName[Name],
  ): Promise<void>
  subscribeToQueue<Name extends QueueName>(
    queueName: Name,
    callback: QueueSubscriber<Name>,
    customSubscriptionName?: string,
  ): Promise<void>
}

export interface ISlackNotifier {
  sendMessage(message: string): Promise<void>
}

export * from './IWalletHandlerFactory'
export * from './IWebSocketService'
export * from './queueSchema'
