import dotenv from 'dotenv'
import http from 'http'

import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { OutboxWorker } from '../../../platform/outbox/OutboxWorker'
import { iocContainer } from '../../container'
import { TYPES } from '../../container/types'

dotenv.config()

const health = { live: true, ready: false }
const baseLogger = iocContainer.get<ILogger>(TYPES.ILogger)
const logger = createScopedLogger(baseLogger, { scope: 'outbox-worker' })

export const createHealthHandler = (state: { live: boolean, ready: boolean }) =>
  (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url || '/'
    if (url.startsWith('/healthz') || url === '/') {
      res.statusCode = 200
      res.setHeader('content-type', 'text/plain')
      res.end('ok')
      return
    }
    if (url.startsWith('/readyz')) {
      const ok = state.live && state.ready
      res.statusCode = ok ? 200 : 503
      res.setHeader('content-type', 'text/plain')
      res.end(ok ? 'ready' : 'not ready')
      return
    }
    res.statusCode = 404
    res.end('not found')
  }

let worker: OutboxWorker | null = null

export function startOutboxWorker(): void {
  worker = iocContainer.get<OutboxWorker>(TYPES.OutboxWorker)
  worker.start()
  health.ready = true
}

export async function stopOutboxWorker(): Promise<void> {
  try {
    await worker?.stop()
  }
  finally {
    worker = null
    health.ready = false
  }
}

if (require.main === module) {
  const port = Number(process.env.HEALTH_PORT || process.env.PORT || 3000)
  const server = http.createServer(createHealthHandler(health))
  server.listen(port, () => logger.info(`outbox worker health server listening on :${port}`))

  startOutboxWorker()
  process.on('SIGINT', async () => {
    health.ready = false
    await stopOutboxWorker()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    health.ready = false
    await stopOutboxWorker()
    process.exit(0)
  })
}
