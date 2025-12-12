import { v4 as uuidv4 } from 'uuid'

import {
  ILogger,
  IQueueHandler,
  JsonValue,
  QueueName,
  UserNotificationMessageSchema,
} from '../interfaces'
import { IWebSocketService } from '../interfaces/IWebSocketService'

type NormalizedNotification = {
  payload: JsonValue
  type: string
  userId: string
}

type WebSocketBridgeOptions = {
  port?: number
  subscriptionName?: string
}

export class WebSocketBridge {
  private readonly port: number
  private shutdownPromise?: Promise<void>
  private readonly subscriptionName: string

  constructor(
    private readonly webSocketService: IWebSocketService,
    private readonly queueHandler: IQueueHandler,
    private readonly logger: ILogger,
    options?: WebSocketBridgeOptions,
  ) {
    this.port = options?.port ?? Number(process.env.WS_PORT ?? 8080)
    this.subscriptionName = options?.subscriptionName ?? `${QueueName.USER_NOTIFICATION}-${uuidv4()}`
  }

  public createShutdownHandler(
    exit: (code?: null | number | string) => never = (code?: null | number | string) => process.exit(
      typeof code === 'number' ? code : 0,
    ),
  ): (signal: NodeJS.Signals) => Promise<void> {
    return async (signal: NodeJS.Signals) => {
      this.logger.info(`[ws] ${signal} received. Shutting down WebSocket bridge...`)
      try {
        await this.shutdown()
      }
      catch (error) {
        this.logger.error('[ws] Error while shutting down WebSocket bridge', error)
      }
      finally {
        exit(0)
      }
    }
  }

  public async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      await this.shutdownPromise
      return
    }

    this.shutdownPromise = this.performShutdown()
    await this.shutdownPromise
  }

  public async start(): Promise<void> {
    await this.webSocketService.start(this.port)
    await this.queueHandler.subscribeToQueue(
      QueueName.USER_NOTIFICATION,
      this.handleQueueMessage,
      this.subscriptionName,
    )
  }

  private readonly handleQueueMessage = (raw: unknown): void => {
    try {
      const notification = this.normalizeNotification(raw)
      if (!notification) {
        return
      }

      this.webSocketService.emitToUser(
        notification.userId,
        notification.type,
        notification.payload,
      )
    }
    catch (error) {
      this.logger.error('[ws] Failed to handle notification message', error)
    }
  }

  private normalizeNotification(raw: unknown): NormalizedNotification | undefined {
    const parsed = UserNotificationMessageSchema.safeParse(raw)
    if (!parsed.success) {
      this.logger.warn('[ws] Invalid notification message received', parsed.error.issues)
      return undefined
    }

    const { id, payload, type, userId } = parsed.data
    const resolvedUserId = this.normalizeUserId(userId ?? id)
    if (!resolvedUserId) {
      this.logger.warn('[ws] Skipping notification without userId', parsed.data)
      return undefined
    }

    return {
      payload: this.normalizePayload(payload),
      type,
      userId: resolvedUserId,
    }
  }

  private normalizePayload(payload: JsonValue | undefined): JsonValue {
    if (payload === undefined || payload === null) {
      return {}
    }

    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload) as JsonValue
      }
      catch {
        return payload
      }
    }

    return payload
  }

  private normalizeUserId(userId?: string): string | undefined {
    if (!userId) {
      return undefined
    }

    const normalized = userId.toString().trim()
    return normalized.length > 0 ? normalized : undefined
  }

  private async performShutdown(): Promise<void> {
    try {
      if (this.queueHandler.closeAllSubscriptions) {
        await this.queueHandler.closeAllSubscriptions()
      }
    }
    catch (error) {
      this.logger.error('[ws] Failed to close queue subscriptions cleanly', error)
    }

    try {
      await this.webSocketService.stop()
    }
    catch (error) {
      this.logger.error('[ws] Failed to stop WebSocket service', error)
    }
  }
}
