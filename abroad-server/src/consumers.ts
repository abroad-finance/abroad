import dotenv from 'dotenv'
import http from 'http'

import { BinanceBalanceUpdatedController } from './controllers/queue/BinanceBalanceUpdatedController'
import { PaymentSentController } from './controllers/queue/PaymentSentController'
import { PaymentStatusUpdatedController } from './controllers/queue/PaymentStatusUpdatedController'
import { ReceivedCryptoTransactionController } from './controllers/queue/ReceivedCryptoTransactionController'
import { iocContainer } from './ioc'
import { TYPES } from './types'

dotenv.config()

// Simple in-process health state
const health = {
  live: true,
  ready: false,
}

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

// Keep module-level strong references to prevent GC
const running: {
  binance?: BinanceBalanceUpdatedController
  payment?: PaymentSentController
  paymentStatus?: PaymentStatusUpdatedController
  received?: ReceivedCryptoTransactionController
} = {}

export function startConsumers(): void {
  const received = iocContainer.get<ReceivedCryptoTransactionController>(
    TYPES.ReceivedCryptoTransactionController,
  )
  const payment = iocContainer.get<PaymentSentController>(
    TYPES.PaymentSentController,
  )
  const paymentStatus = iocContainer.get<PaymentStatusUpdatedController>(
    TYPES.PaymentStatusUpdatedController,
  )
  const binance = iocContainer.get<BinanceBalanceUpdatedController>(
    TYPES.BinanceBalanceUpdatedController,
  )

  running.received = received
  running.payment = payment
  running.paymentStatus = paymentStatus
  running.binance = binance

  received.registerConsumers()
  payment.registerConsumers()
  paymentStatus.registerConsumers()
  binance.registerConsumers()

  // Mark ready after consumers and auth init are set up
  health.ready = true
}

export async function stopConsumers(): Promise<void> {
  try {
    const qh = iocContainer.get<import('./interfaces').IQueueHandler>(
      TYPES.IQueueHandler,
    )
    if (qh.closeAllSubscriptions) await qh.closeAllSubscriptions()
  }
  finally {
    running.received = undefined
    running.payment = undefined
    running.binance = undefined
  }
}

if (require.main === module) {
  // Start a tiny HTTP server for k8s health checks
  const port = Number(process.env.HEALTH_PORT || process.env.PORT || 3000)
  const server = http.createServer(createHealthHandler(health))
  server.listen(port, () => {
    console.log(`[consumers] health server listening on :${port}`)
  })

  startConsumers()
  process.on('SIGINT', async () => {
    health.ready = false
    await stopConsumers()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    health.ready = false
    await stopConsumers()
    process.exit(0)
  })
}
