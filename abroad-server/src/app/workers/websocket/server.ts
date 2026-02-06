// WebSocket bridge using the app's Pub/Sub infrastructure
import dotenv from 'dotenv'

import { ILogger } from '../../../core/logging/types'
import { WebSocketBridge } from '../../../modules/realtime/application/WebSocketBridge'
import { IQueueHandler } from '../../../platform/messaging/queues'
import { IWebSocketService } from '../../../platform/notifications/IWebSocketService'
import { initSentry } from '../../../platform/observability/sentry'
import { iocContainer } from '../../container'
import { TYPES } from '../../container/types'

dotenv.config()
initSentry({ serviceName: 'abroad-websocket-bridge' })

async function main() {
  const logger = resolveLogger()
  const webSocketService = iocContainer.get<IWebSocketService>(TYPES.IWebSocketService)
  const queueHandler = iocContainer.get<IQueueHandler>(TYPES.IQueueHandler)

  const bridge = new WebSocketBridge(webSocketService, queueHandler, logger)
  await bridge.start()

  const shutdown = bridge.createShutdownHandler()
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function resolveLogger(): ILogger {
  try {
    const logger = iocContainer.get<ILogger>(TYPES.ILogger)
    if (logger) {
      return logger
    }
  }
  catch {
  }

  return {
    error: (message: string, ...optionalParams: unknown[]) => console.error(message, ...optionalParams),
    info: (message: string, ...optionalParams: unknown[]) => console.info(message, ...optionalParams),
    warn: (message: string, ...optionalParams: unknown[]) => console.warn(message, ...optionalParams),
  }
}

main().catch((err) => {
  const logger = resolveLogger()
  logger.error('[ws] fatal error during startup:', err)
  process.exit(1)
})
