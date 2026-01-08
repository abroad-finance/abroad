import dotenv from 'dotenv'
import http from 'http'

import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { OutboxRepository } from '../../../platform/outbox/OutboxRepository'
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
    if (url.startsWith('/stats')) {
      void respondWithStats(res).catch((error) => {
        logger.error('[outbox-worker] Failed to serve /stats', error)
        res.statusCode = 500
        res.end('error')
      })
      return
    }
    res.statusCode = 404
    res.end('not found')
  }

let worker: OutboxWorker | null = null
let repository: OutboxRepository | null = null

export function startOutboxWorker(): void {
  worker = iocContainer.get<OutboxWorker>(TYPES.OutboxWorker)
  repository = iocContainer.get<OutboxRepository>(OutboxRepository)
  worker.start()
  health.ready = true
}

export async function stopOutboxWorker(): Promise<void> {
  try {
    await worker?.stop()
  }
  finally {
    worker = null
    repository = null
    health.ready = false
  }
}

async function respondWithStats(res: http.ServerResponse): Promise<void> {
  if (!repository) {
    res.statusCode = 503
    res.end('outbox not ready')
    return
  }
  const summary = await repository.summarizeFailures()
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(summary))
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
