import { Container } from 'inversify'

import { BinanceBalanceUpdatedController } from '../controllers/queue/BinanceBalanceUpdatedController'
import { PaymentSentController } from '../controllers/queue/PaymentSentController'
import { PaymentStatusUpdatedController } from '../controllers/queue/PaymentStatusUpdatedController'
import { ReceivedCryptoTransactionController } from '../controllers/queue/ReceivedCryptoTransactionController'
import { TYPES } from '../types'
import { BindingRegistration, registerBindings } from './bindingSupport'

const queueBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { identifier: TYPES.ReceivedCryptoTransactionController, implementation: ReceivedCryptoTransactionController },
  { identifier: TYPES.PaymentSentController, implementation: PaymentSentController },
  { identifier: TYPES.PaymentStatusUpdatedController, implementation: PaymentStatusUpdatedController },
  { identifier: TYPES.BinanceBalanceUpdatedController, implementation: BinanceBalanceUpdatedController },
] as const

export function bindQueueControllers(container: Container): void {
  registerBindings(container, queueBindings)
}
