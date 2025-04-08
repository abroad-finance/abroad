// src/interfaces/index.ts
import { Partner } from '@prisma/client'
import { Request } from 'express'

// The enum and interface definitions:
export enum QueueName {
  PAYMENT_SENT = 'payment-sent',
  RECEIVED_CRYTPO_TRANSACTION = 'received-crypto-transaction',
}

export interface ILogger {
  error(message: string, ...optionalParams: unknown[]): void
  info(message: string, ...optionalParams: unknown[]): void
  warn(message: string, ...optionalParams: unknown[]): void
}

export interface IPartnerService {
  getPartnerFromApiKey(apiKey?: string): Promise<Partner>
  getPartnerFromRequest(request: Request): Promise<Partner>
}

export interface IQueueHandler {
  postMessage(
    queueName: QueueName,
    message: Record<string, boolean | number | string>,
  ): void
  subscribeToQueue(
    queueName: QueueName,
    callback: (message: Record<string, boolean | number | string>) => void,
  ): void
}

export interface ISlackNotifier {
  sendMessage(message: string): Promise<void>
}
