import dotenv from 'dotenv'

import { BinanceBalanceUpdatedController } from './controllers/queue/BinanceBalanceUpdatedController'
import { PaymentSentController } from './controllers/queue/PaymentSentController'
import { PaymentStatusUpdatedController } from './controllers/queue/PaymentStatusUpdatedController'
import { ReceivedCryptoTransactionController } from './controllers/queue/ReceivedCryptoTransactionController'
import { IAuthService } from './interfaces'
import { iocContainer } from './ioc'
import { TYPES } from './types'

dotenv.config()

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

  iocContainer.get<IAuthService>(TYPES.IAuthService).initialize()
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
  startConsumers()
  process.on('SIGINT', async () => {
    await stopConsumers()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    await stopConsumers()
    process.exit(0)
  })
}
