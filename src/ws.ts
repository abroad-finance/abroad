// WebSocket bridge using the app's Pub/Sub infrastructure
import dotenv from 'dotenv'

import { IQueueHandler, QueueName, UserNotificationMessageSchema } from './interfaces'
import { IWebSocketService } from './interfaces/IWebSocketService'
import { iocContainer } from './ioc'
import { TYPES } from './types'

dotenv.config()

type JsonObject = Record<string, unknown>

async function main() {
  const ws = iocContainer.get<IWebSocketService>(TYPES.IWebSocketService)
  const port = Number(process.env.WS_PORT || 8080)
  await ws.start(port)

  // Resolve the shared Pub/Sub handler via IoC
  const queueHandler = iocContainer.get<IQueueHandler>(TYPES.IQueueHandler)

  // Subscribe to user notification messages and forward to Socket.IO
  await queueHandler.subscribeToQueue(QueueName.USER_NOTIFICATION, (raw) => {
    try {
      const parsed = UserNotificationMessageSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn('[ws] Invalid notification message:', parsed.error.issues)
        return
      }
      const data = parsed.data
      // Normalize payload: string → JSON object when possible
      let payload: JsonObject | string | undefined = data.payload
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload) as JsonObject
        }
        catch {
          // keep as raw string if not JSON
        }
      }
      const userId = (data.userId || data.id || '').toString().trim()
      if (!userId) {
        console.warn('[ws] Skipping notification without userId:', data)
        return
      }
      ws.emitToUser(userId, data.type, payload ?? {})
    }
    catch (err) {
      console.error('[ws] Failed to handle notification message:', err)
    }
  })

  // Graceful shutdown
  const shutdown = async () => {
    try {
      if (queueHandler.closeAllSubscriptions) {
        await queueHandler.closeAllSubscriptions()
      }
    }
    finally {
      await ws.stop()
      process.exit(0)
    }
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[ws] fatal error during startup:', err)
  process.exit(1)
})
