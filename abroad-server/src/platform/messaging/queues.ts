// src/platform/messaging/queues.ts
import { ZodType } from 'zod'

import {
  BinanceBalanceUpdatedMessage,
  BinanceBalanceUpdatedMessageSchema,
  DeadLetterMessage,
  DeadLetterMessageSchema,
  PaymentSentMessage,
  PaymentSentMessageSchema,
  PaymentStatusUpdatedMessage,
  PaymentStatusUpdatedMessageSchema,
  ReceivedCryptoTransactionMessage,
  ReceivedCryptoTransactionMessageSchema,
  UserNotificationMessage,
  UserNotificationMessageSchema,
} from './queueSchema'

export enum QueueName {
  BINANCE_BALANCE_UPDATED = 'binance-balance-updated',
  DEAD_LETTER = 'dead-letter',
  PAYMENT_SENT = 'payment-sent',
  PAYMENT_STATUS_UPDATED = 'payment-status-updated',
  RECEIVED_CRYPTO_TRANSACTION = 'received-crypto-transaction',
  USER_NOTIFICATION = 'user-notification',
}

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

export type QueuePayloadByName = {
  [QueueName.BINANCE_BALANCE_UPDATED]: BinanceBalanceUpdatedMessage
  [QueueName.DEAD_LETTER]: DeadLetterMessage
  [QueueName.PAYMENT_SENT]: PaymentSentMessage
  [QueueName.PAYMENT_STATUS_UPDATED]: PaymentStatusUpdatedMessage
  [QueueName.RECEIVED_CRYPTO_TRANSACTION]: ReceivedCryptoTransactionMessage
  [QueueName.USER_NOTIFICATION]: UserNotificationMessage
}

type QueuePayloadSchemaMap = {
  [Name in QueueName]: ZodType<QueuePayloadByName[Name]>
}

export const QueuePayloadSchemaByName: QueuePayloadSchemaMap = {
  [QueueName.BINANCE_BALANCE_UPDATED]: BinanceBalanceUpdatedMessageSchema,
  [QueueName.DEAD_LETTER]: DeadLetterMessageSchema,
  [QueueName.PAYMENT_SENT]: PaymentSentMessageSchema,
  [QueueName.PAYMENT_STATUS_UPDATED]: PaymentStatusUpdatedMessageSchema,
  [QueueName.RECEIVED_CRYPTO_TRANSACTION]: ReceivedCryptoTransactionMessageSchema,
  [QueueName.USER_NOTIFICATION]: UserNotificationMessageSchema,
}

export type QueueSubscriber<Name extends QueueName> = (
  message: QueuePayloadByName[Name],
) => Promise<void> | void

export * from './queueSchema'
