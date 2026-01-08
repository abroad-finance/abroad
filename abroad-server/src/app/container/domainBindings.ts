import { Container } from 'inversify'

import { PaymentSentUseCase } from '../../modules/payments/application/paymentSentUseCase'
import { PaymentServiceFactory } from '../../modules/payments/application/PaymentServiceFactory'
import { PaymentUseCase } from '../../modules/payments/application/paymentUseCase'
import { PayoutStatusAdapterRegistry } from '../../modules/payments/application/PayoutStatusAdapterRegistry'
import { WalletHandlerFactory } from '../../modules/payments/application/WalletHandlerFactory'
import { DepositVerifierRegistry } from '../../modules/payments/application/DepositVerifierRegistry'
import { BrebPaymentService } from '../../modules/payments/infrastructure/paymentProviders/brebPaymentService'
import { PixQrDecoder } from '../../modules/payments/infrastructure/paymentProviders/PixQrDecoder'
import { TransferoPaymentService } from '../../modules/payments/infrastructure/paymentProviders/transferoPaymentService'
import { TransferoPayoutStatusAdapter } from '../../modules/payments/infrastructure/TransferoPayoutStatusAdapter'
import { SolanaPaymentVerifier } from '../../modules/payments/infrastructure/wallets/SolanaPaymentVerifier'
import { SolanaWalletHandler } from '../../modules/payments/infrastructure/wallets/SolanaWalletHandler'
import { StellarWalletHandler } from '../../modules/payments/infrastructure/wallets/StellarWalletHandler'
import { QuoteUseCase } from '../../modules/quotes/application/quoteUseCase'
import { ReceivedCryptoTransactionUseCase } from '../../modules/transactions/application/receivedCryptoTransactionUseCase'
import { TransactionAcceptanceService } from '../../modules/transactions/application/TransactionAcceptanceService'
import { TransactionStatusService } from '../../modules/transactions/application/TransactionStatusService'
import { TransactionWorkflow } from '../../modules/transactions/application/TransactionWorkflow'
import { ExchangeProviderFactory } from '../../modules/treasury/application/ExchangeProviderFactory'
import { BinanceExchangeProvider } from '../../modules/treasury/infrastructure/exchangeProviders/binanceExchangeProvider'
import { TransferoExchangeProvider } from '../../modules/treasury/infrastructure/exchangeProviders/transferoExchangeProvider'
import { StellarListener } from '../../modules/treasury/interfaces/listeners/StellarListener'
import { PersonaWebhookService } from '../../modules/webhooks/application/PersonaWebhookService'
import { BindingRegistration, registerBindings } from './bindingSupport'
import { TYPES } from './types'

const domainBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { identifier: TYPES.IPaymentServiceFactory, implementation: PaymentServiceFactory },
  { identifier: TYPES.IDepositVerifierRegistry, implementation: DepositVerifierRegistry },
  { bindSelf: true, identifier: PayoutStatusAdapterRegistry, implementation: PayoutStatusAdapterRegistry },
  { identifier: TYPES.IPayoutStatusAdapter, implementation: TransferoPayoutStatusAdapter, name: 'transfero' },
  { identifier: TYPES.IExchangeProviderFactory, implementation: ExchangeProviderFactory },
  { identifier: TYPES.IWalletHandlerFactory, implementation: WalletHandlerFactory },
  { identifier: TYPES.IPixQrDecoder, implementation: PixQrDecoder },
  { identifier: TYPES.QuoteUseCase, implementation: QuoteUseCase },
  { identifier: TYPES.SolanaPaymentVerifier, implementation: SolanaPaymentVerifier },
  { identifier: TYPES.SolanaWalletHandler, implementation: SolanaWalletHandler },
  { identifier: TYPES.StellarListener, implementation: StellarListener },
  { identifier: TYPES.StellarWalletHandler, implementation: StellarWalletHandler },
  { identifier: TYPES.StellarListener, implementation: StellarListener },
  { identifier: TYPES.IPaymentService, implementation: BrebPaymentService, name: 'breb' },
  { identifier: TYPES.IPaymentService, implementation: TransferoPaymentService, name: 'transfero' },
  { identifier: TYPES.IDepositVerifier, implementation: SolanaPaymentVerifier, name: 'solana' },
  { identifier: TYPES.IExchangeProvider, implementation: BinanceExchangeProvider, name: 'binance' },
  { identifier: TYPES.IExchangeProvider, implementation: TransferoExchangeProvider, name: 'transfero' },
  { identifier: TYPES.TransactionAcceptanceService, implementation: TransactionAcceptanceService },
  { identifier: TYPES.TransactionStatusService, implementation: TransactionStatusService },
  { identifier: TYPES.TransactionWorkflow, implementation: TransactionWorkflow },
  { identifier: TYPES.PaymentUseCase, implementation: PaymentUseCase },
  { identifier: TYPES.PaymentSentUseCase, implementation: PaymentSentUseCase },
  { identifier: TYPES.ReceivedCryptoTransactionUseCase, implementation: ReceivedCryptoTransactionUseCase },
  { bindSelf: true, identifier: PersonaWebhookService, implementation: PersonaWebhookService },
] as const

export function bindDomainServices(container: Container): void {
  registerBindings(container, domainBindings)
}
