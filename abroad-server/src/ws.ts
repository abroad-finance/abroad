// WebSocket bridge using the app's Pub/Sub infrastructure
import dotenv from 'dotenv'

import { ILogger, IQueueHandler } from './interfaces'
import { IWebSocketService } from './interfaces/IWebSocketService'
import { iocContainer } from './ioc'
import { WebSocketBridge } from './services/WebSocketBridge'
import { TYPES } from './types'

dotenv.config()

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
