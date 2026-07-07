import dotenv from 'dotenv'
import http from 'http'

import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { BridgeSweepWorker } from '../../../modules/treasury/application/BridgeSweepWorker'
import { TreasurySnapshotWorker } from '../../../modules/treasury/application/TreasurySnapshotWorker'
import { initSentry } from '../../../platform/observability/sentry'
import { iocContainer } from '../../container'
import { TYPES } from '../../container/types'

dotenv.config()
initSentry({ serviceName: 'abroad-bridge-sweep-worker' })

const health = { live: true, ready: false }
const baseLogger = iocContainer.get<ILogger>(TYPES.ILogger)
const logger = createScopedLogger(baseLogger, { scope: 'bridge-sweep-worker' })

export const createHealthHandler = (state: { live: boolean, ready: boolean }) =>
  (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url || '/'
    if (url.startsWith('/readyz')) {
      const ok = state.live && state.ready
      res.statusCode = ok ? 200 : 503
      res.end(ok ? 'ready' : 'not ready')
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'text/plain')
    res.end('ok')
  }

let worker: BridgeSweepWorker | null = null
let snapshotWorker: null | TreasurySnapshotWorker = null

export function startBridgeSweepWorker(): void {
  worker = iocContainer.get<BridgeSweepWorker>(BridgeSweepWorker)
  worker.start()
  // The treasury snapshot loop rides along in this service: same lifecycle,
  // no extra Cloud Run deployment for an hourly background read.
  snapshotWorker = iocContainer.get<TreasurySnapshotWorker>(TreasurySnapshotWorker)
  snapshotWorker.start()
  health.ready = true
}

export async function stopBridgeSweepWorker(): Promise<void> {
  try {
    await Promise.all([worker?.stop(), snapshotWorker?.stop()])
  }
  finally {
    worker = null
    snapshotWorker = null
    health.ready = false
  }
}

if (require.main === module) {
  const port = Number(process.env.HEALTH_PORT || process.env.PORT || 3000)
  const server = http.createServer(createHealthHandler(health))
  server.listen(port, () => logger.info(`bridge-sweep worker health server listening on :${port}`))

  startBridgeSweepWorker()
  process.on('SIGINT', async () => {
    health.ready = false
    await stopBridgeSweepWorker()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    health.ready = false
    await stopBridgeSweepWorker()
    process.exit(0)
  })
}
