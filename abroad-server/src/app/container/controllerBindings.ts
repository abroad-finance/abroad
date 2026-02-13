import { Container } from 'inversify'

import { WalletAuthController } from '../../modules/auth/interfaces/http/WalletAuthController'
import { FlowCorridorController } from '../../modules/flows/interfaces/http/FlowCorridorController'
import { FlowDefinitionController } from '../../modules/flows/interfaces/http/FlowDefinitionController'
import { FlowInstanceController } from '../../modules/flows/interfaces/http/FlowInstanceController'
import { PublicCorridorController } from '../../modules/flows/interfaces/http/PublicCorridorController'
import { OpsPartnerController } from '../../modules/partners/interfaces/http/OpsPartnerController'
import { PartnerController } from '../../modules/partners/interfaces/http/PartnerController'
import { PartnerUserController } from '../../modules/partners/interfaces/http/PartnerUserController'
import { CeloPaymentsController } from '../../modules/payments/interfaces/http/CeloPaymentsController'
import { CryptoAssetController } from '../../modules/payments/interfaces/http/CryptoAssetController'
import { PaymentsController } from '../../modules/payments/interfaces/http/PaymentsController'
import { PaymentsNotifyController } from '../../modules/payments/interfaces/http/PaymentsNotifyController'
import { QrDecoderController } from '../../modules/payments/interfaces/http/QrDecoderController'
import { SolanaPaymentsController } from '../../modules/payments/interfaces/http/SolanaPaymentsController'
import { QuoteController } from '../../modules/quotes/interfaces/http/QuoteController'
import { PublicTransactionsController } from '../../modules/transactions/interfaces/http/PublicTransactionsController'
import { TransactionController } from '../../modules/transactions/interfaces/http/TransactionController'
import { TransactionsController } from '../../modules/transactions/interfaces/http/TransactionsController'
import { WebhookController } from '../../modules/webhooks/interfaces/http/WebhookController'
import { BindingRegistration, registerBindings } from './bindingSupport'

const controllerBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { bindSelf: true, identifier: WebhookController, implementation: WebhookController },
  { bindSelf: true, identifier: PartnerController, implementation: PartnerController },
  { bindSelf: true, identifier: OpsPartnerController, implementation: OpsPartnerController },
  { bindSelf: true, identifier: PartnerUserController, implementation: PartnerUserController },
  { bindSelf: true, identifier: QuoteController, implementation: QuoteController },
  { bindSelf: true, identifier: TransactionController, implementation: TransactionController },
  { bindSelf: true, identifier: TransactionsController, implementation: TransactionsController },
  { bindSelf: true, identifier: PublicTransactionsController, implementation: PublicTransactionsController },
  { bindSelf: true, identifier: PaymentsController, implementation: PaymentsController },
  { bindSelf: true, identifier: CryptoAssetController, implementation: CryptoAssetController },
  { bindSelf: true, identifier: QrDecoderController, implementation: QrDecoderController },
  { bindSelf: true, identifier: WalletAuthController, implementation: WalletAuthController },
  { bindSelf: true, identifier: PaymentsNotifyController, implementation: PaymentsNotifyController },
  { bindSelf: true, identifier: SolanaPaymentsController, implementation: SolanaPaymentsController },
  { bindSelf: true, identifier: CeloPaymentsController, implementation: CeloPaymentsController },
  { bindSelf: true, identifier: FlowDefinitionController, implementation: FlowDefinitionController },
  { bindSelf: true, identifier: FlowCorridorController, implementation: FlowCorridorController },
  { bindSelf: true, identifier: PublicCorridorController, implementation: PublicCorridorController },
  { bindSelf: true, identifier: FlowInstanceController, implementation: FlowInstanceController },
] as const

export function bindHttpControllers(container: Container): void {
  registerBindings(container, controllerBindings)
}
