import { Container } from 'inversify'

import { PaymentStatusUpdatedController } from '../../modules/payments/interfaces/queue/PaymentStatusUpdatedController'
import { ReceivedCryptoTransactionController } from '../../modules/transactions/interfaces/queue/ReceivedCryptoTransactionController'
import { ExchangeBalanceUpdatedController } from '../../modules/treasury/interfaces/queue/ExchangeBalanceUpdatedController'
import { DeadLetterController } from '../../platform/messaging/DeadLetterController'
import { BindingRegistration, registerBindings } from './bindingSupport'
import { TYPES } from './types'

const queueBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { identifier: TYPES.DeadLetterController, implementation: DeadLetterController },
  { identifier: TYPES.ReceivedCryptoTransactionController, implementation: ReceivedCryptoTransactionController },
  { identifier: TYPES.PaymentStatusUpdatedController, implementation: PaymentStatusUpdatedController },
  { identifier: TYPES.ExchangeBalanceUpdatedController, implementation: ExchangeBalanceUpdatedController },
] as const

export function bindQueueControllers(container: Container): void {
  registerBindings(container, queueBindings)
}
