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
import { WalletHandlerFactory } from '../services/WalletHandlerFactory'
import { TYPES } from '../types'
import { QuoteUseCase } from '../useCases/quoteUseCase'
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
] as const

export function bindDomainServices(container: Container): void {
  registerBindings(container, domainBindings)
}
