import dotenv from 'dotenv'
import http from 'http'

import { IAuthService } from './interfaces'
import { iocContainer } from './ioc'
import { startListeners } from './listeners/index'
import { TYPES } from './types'

dotenv.config()

const health = { live: true, ready: false }

// Start a tiny HTTP server for k8s health checks
const port = Number(process.env.HEALTH_PORT || process.env.PORT || 3000)
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
  console.log(`[listeners] health server listening on :${port}`)
})

startListeners()

iocContainer.get<IAuthService>(TYPES.IAuthService).initialize()
health.ready = true

process.on('SIGINT', () => {
  health.ready = false
  process.exit(0)
})
process.on('SIGTERM', () => {
  health.ready = false
  process.exit(0)
})
