import dotenv from 'dotenv'
import http from 'http'

import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { startListeners } from '../../../modules/treasury/interfaces/listeners'
import { initSentry } from '../../../platform/observability/sentry'
import { RuntimeConfig } from '../../config/runtime'
import { iocContainer } from '../../container'
import { TYPES } from '../../container/types'

dotenv.config()
initSentry({ serviceName: 'abroad-listeners' })

const baseLogger = iocContainer.get<ILogger>(TYPES.ILogger)
const logger = createScopedLogger(baseLogger, { scope: 'listeners' })
const health = { live: true, ready: false }

// Start a tiny HTTP server for k8s health checks
const port = RuntimeConfig.server.healthPort
const server = http.createServer((req, res) => {
  const url = req.url || '/'
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
})
server.listen(port, () => {
  logger.info(`[listeners] health server listening on :${port}`)
})

startListeners()

health.ready = true

process.on('SIGINT', () => {
  health.ready = false
  logger.info('[listeners] SIGINT received; exiting')
  process.exit(0)
})
process.on('SIGTERM', () => {
  health.ready = false
  logger.info('[listeners] SIGTERM received; exiting')
  process.exit(0)
})
