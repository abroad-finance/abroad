import { Container } from 'inversify'

import { ExchangeProviderFactory } from '../services/ExchangeProviderFactory'
import { BinanceExchangeProvider } from '../services/exchangeProviders/binanceExchangeProvider'
import { TransferoExchangeProvider } from '../services/exchangeProviders/transferoExchangeProvider'
import { PaymentServiceFactory } from '../services/PaymentServiceFactory'
import { BrebPaymentService } from '../services/paymentServices/brebPaymentService'
import { MoviiPaymentService } from '../services/paymentServices/movii'
import { NequiPaymentService } from '../services/paymentServices/nequi'
import { TransferoPaymentService } from '../services/paymentServices/transferoPaymentService'
import { PixQrDecoder } from '../services/PixQrDecoder'
import { SolanaWalletHandler } from '../services/SolanaWalletHandler'
import { StellarWalletHandler } from '../services/StellarWalletHandler'
import { TransactionAcceptanceService } from '../services/TransactionAcceptanceService'
import { TransactionStatusService } from '../services/TransactionStatusService'
import { WalletHandlerFactory } from '../services/WalletHandlerFactory'
import { PersonaWebhookService } from '../services/webhooks/PersonaWebhookService'
import { TYPES } from '../types'
import { PaymentSentUseCase } from '../useCases/paymentSentUseCase'
import { PaymentUseCase } from '../useCases/paymentUseCase'
import { QuoteUseCase } from '../useCases/quoteUseCase'
import { ReceivedCryptoTransactionUseCase } from '../useCases/receivedCryptoTransactionUseCase'
import { BindingRegistration, registerBindings } from './bindingSupport'

const domainBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { identifier: TYPES.IPaymentServiceFactory, implementation: PaymentServiceFactory },
  { identifier: TYPES.IExchangeProviderFactory, implementation: ExchangeProviderFactory },
  { identifier: TYPES.IWalletHandlerFactory, implementation: WalletHandlerFactory },
  { identifier: TYPES.IPixQrDecoder, implementation: PixQrDecoder },
  { identifier: TYPES.QuoteUseCase, implementation: QuoteUseCase },
  { identifier: TYPES.SolanaWalletHandler, implementation: SolanaWalletHandler },
  { identifier: TYPES.StellarWalletHandler, implementation: StellarWalletHandler },
  { identifier: TYPES.IPaymentService, implementation: MoviiPaymentService, name: 'movii' },
  { identifier: TYPES.IPaymentService, implementation: NequiPaymentService, name: 'nequi' },
  { identifier: TYPES.IPaymentService, implementation: BrebPaymentService, name: 'breb' },
  { identifier: TYPES.IPaymentService, implementation: TransferoPaymentService, name: 'transfero' },
  { identifier: TYPES.IExchangeProvider, implementation: BinanceExchangeProvider, name: 'binance' },
  { identifier: TYPES.IExchangeProvider, implementation: TransferoExchangeProvider, name: 'transfero' },
  { identifier: TYPES.TransactionAcceptanceService, implementation: TransactionAcceptanceService },
  { identifier: TYPES.TransactionStatusService, implementation: TransactionStatusService },
  { identifier: TYPES.PaymentUseCase, implementation: PaymentUseCase },
  { identifier: TYPES.PaymentSentUseCase, implementation: PaymentSentUseCase },
  { identifier: TYPES.ReceivedCryptoTransactionUseCase, implementation: ReceivedCryptoTransactionUseCase },
  { bindSelf: true, identifier: PersonaWebhookService, implementation: PersonaWebhookService },
] as const

export function bindDomainServices(container: Container): void {
  registerBindings(container, domainBindings)
}
