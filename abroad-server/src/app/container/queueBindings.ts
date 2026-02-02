import { Container } from 'inversify'

import { PaymentStatusUpdatedController } from '../../modules/payments/interfaces/queue/PaymentStatusUpdatedController'
import { ReceivedCryptoTransactionController } from '../../modules/transactions/interfaces/queue/ReceivedCryptoTransactionController'
import { BinanceBalanceUpdatedController } from '../../modules/treasury/interfaces/queue/BinanceBalanceUpdatedController'
import { DeadLetterController } from '../../platform/messaging/DeadLetterController'
import { BindingRegistration, registerBindings } from './bindingSupport'
import { TYPES } from './types'

const queueBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { identifier: TYPES.DeadLetterController, implementation: DeadLetterController },
  { identifier: TYPES.ReceivedCryptoTransactionController, implementation: ReceivedCryptoTransactionController },
  { identifier: TYPES.PaymentStatusUpdatedController, implementation: PaymentStatusUpdatedController },
  { identifier: TYPES.BinanceBalanceUpdatedController, implementation: BinanceBalanceUpdatedController },
] as const

export function bindQueueControllers(container: Container): void {
  registerBindings(container, queueBindings)
}
