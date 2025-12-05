import { Container } from 'inversify'

import { ConversionController } from '../controllers/ConversionController'
import { PartnerController } from '../controllers/PartnerController'
import { PartnerUserController } from '../controllers/PartnerUserController'
import { PaymentsController } from '../controllers/PaymentsController'
import { PublicTransactionsController } from '../controllers/PublicTransactionsController'
import { QrDecoderController } from '../controllers/QrDecoderController'
import { QuoteController } from '../controllers/QuoteController'
import { SolanaPaymentsController } from '../controllers/SolanaPaymentsController'
import { TransactionController } from '../controllers/TransactionController'
import { TransactionsController } from '../controllers/TransactionsController'
import { WalletAuthController } from '../controllers/WalletAuthController'
import { WebhookController } from '../controllers/WebhookController'
import { BindingRegistration, registerBindings } from './bindingSupport'

const controllerBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { bindSelf: true, identifier: WebhookController, implementation: WebhookController },
  { bindSelf: true, identifier: PartnerController, implementation: PartnerController },
  { bindSelf: true, identifier: PartnerUserController, implementation: PartnerUserController },
  { bindSelf: true, identifier: ConversionController, implementation: ConversionController },
  { bindSelf: true, identifier: QuoteController, implementation: QuoteController },
  { bindSelf: true, identifier: TransactionController, implementation: TransactionController },
  { bindSelf: true, identifier: TransactionsController, implementation: TransactionsController },
  { bindSelf: true, identifier: PublicTransactionsController, implementation: PublicTransactionsController },
  { bindSelf: true, identifier: PaymentsController, implementation: PaymentsController },
  { bindSelf: true, identifier: QrDecoderController, implementation: QrDecoderController },
  { bindSelf: true, identifier: WalletAuthController, implementation: WalletAuthController },
  { bindSelf: true, identifier: SolanaPaymentsController, implementation: SolanaPaymentsController },
] as const

export function bindHttpControllers(container: Container): void {
  registerBindings(container, controllerBindings)
}
