import dotenv from 'dotenv'
import http from 'http'

import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { iocContainer } from '../../container'
import { TYPES } from '../../container/types'

dotenv.config()

const health = { live: true, ready: false }
const baseLogger = iocContainer.get<ILogger>(TYPES.ILogger)
const logger = createScopedLogger(baseLogger, { scope: 'outbox-worker' })
const dispatcher = iocContainer.get<OutboxDispatcher>(TYPES.IOutboxDispatcher)
const pollEveryMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 5_000)

let poller: ReturnType<typeof setInterval> | undefined
let inFlight = false

export function startOutboxWorker(): void {
  void tickOutbox()
  poller = setInterval(() => {
    void tickOutbox()
  }, pollEveryMs)
  health.ready = true
}

export function stopOutboxWorker(): void {
  if (poller) {
    clearInterval(poller)
    poller = undefined
  }
  health.ready = false
}

async function tickOutbox(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    await dispatcher.processPending()
  }
  catch (error) {
    logger.error('Outbox worker iteration failed', error)
  }
  finally {
    inFlight = false
  }
}

const healthHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
  const url = req.url ?? '/'
  if (url.startsWith('/healthz') || url === '/') {
    res.statusCode = 200
    res.setHeader('content-type', 'text/plain')
    res.end('ok')
    return
  }
  if (url.startsWith('/readyz')) {
    const ok = health.live && health.ready
    res.statusCode = ok ? 200 : 503
    res.setHeader('content-type', 'text/plain')
    res.end(ok ? 'ready' : 'not ready')
    return
  }
  res.statusCode = 404
  res.end('not found')
}

if (require.main === module) {
  const port = Number(process.env.OUTBOX_HEALTH_PORT ?? process.env.PORT ?? 3004)
  const server = http.createServer(healthHandler)
  server.listen(port, () => {
    logger.info(`outbox worker health server listening on :${port}`)
  })

  startOutboxWorker()

  process.on('SIGINT', () => {
    health.ready = false
    stopOutboxWorker()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    health.ready = false
    stopOutboxWorker()
    process.exit(0)
  })
}
