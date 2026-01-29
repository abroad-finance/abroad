import { Container } from 'inversify'

import { WalletAuthController } from '../../modules/auth/interfaces/http/WalletAuthController'
import { PartnerController } from '../../modules/partners/interfaces/http/PartnerController'
import { PartnerUserController } from '../../modules/partners/interfaces/http/PartnerUserController'
import { CeloPaymentsController } from '../../modules/payments/interfaces/http/CeloPaymentsController'
import { PaymentsController } from '../../modules/payments/interfaces/http/PaymentsController'
import { QrDecoderController } from '../../modules/payments/interfaces/http/QrDecoderController'
import { SolanaPaymentsController } from '../../modules/payments/interfaces/http/SolanaPaymentsController'
import { QuoteController } from '../../modules/quotes/interfaces/http/QuoteController'
import { PublicTransactionsController } from '../../modules/transactions/interfaces/http/PublicTransactionsController'
import { TransactionController } from '../../modules/transactions/interfaces/http/TransactionController'
import { TransactionsController } from '../../modules/transactions/interfaces/http/TransactionsController'
import { ConversionController } from '../../modules/treasury/interfaces/http/ConversionController'
import { WebhookController } from '../../modules/webhooks/interfaces/http/WebhookController'
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
  { bindSelf: true, identifier: CeloPaymentsController, implementation: CeloPaymentsController },
] as const

export function bindHttpControllers(container: Container): void {
  registerBindings(container, controllerBindings)
}
