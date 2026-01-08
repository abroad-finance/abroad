import dotenv from 'dotenv'
import http from 'http'

import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { PaymentSentController } from '../../../modules/payments/interfaces/queue/PaymentSentController'
import { PaymentStatusUpdatedController } from '../../../modules/payments/interfaces/queue/PaymentStatusUpdatedController'
import { ReceivedCryptoTransactionController } from '../../../modules/transactions/interfaces/queue/ReceivedCryptoTransactionController'
import { BinanceBalanceUpdatedController } from '../../../modules/treasury/interfaces/queue/BinanceBalanceUpdatedController'
import { DeadLetterController } from '../../../platform/messaging/DeadLetterController'
import { iocContainer } from '../../container'
import { TYPES } from '../../container/types'

dotenv.config()

// Simple in-process health state
const health = {
  live: true,
  ready: false,
}
const baseLogger = iocContainer.get<ILogger>(TYPES.ILogger)
const logger = createScopedLogger(baseLogger, { scope: 'consumers' })

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
  deadLetter?: DeadLetterController
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
  const deadLetter = iocContainer.get<DeadLetterController>(
    TYPES.DeadLetterController,
  )

  running.received = received
  running.payment = payment
  running.paymentStatus = paymentStatus
  running.binance = binance
  running.deadLetter = deadLetter

  deadLetter.registerConsumers()
  received.registerConsumers()
  payment.registerConsumers()
  paymentStatus.registerConsumers()
  binance.registerConsumers()

  // Mark ready after consumers and auth init are set up
  health.ready = true
}

export async function stopConsumers(): Promise<void> {
  try {
    const qh = iocContainer.get<import('../../../platform/messaging/queues').IQueueHandler>(
      TYPES.IQueueHandler,
    )
    if (qh.closeAllSubscriptions) await qh.closeAllSubscriptions()
  }
  finally {
    running.received = undefined
    running.payment = undefined
    running.binance = undefined
    running.deadLetter = undefined
  }
}

if (require.main === module) {
  // Start a tiny HTTP server for k8s health checks
  const port = Number(process.env.HEALTH_PORT || process.env.PORT || 3000)
  const server = http.createServer(createHealthHandler(health))
  server.listen(port, () => {
    logger.info(`health server listening on :${port}`)
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
