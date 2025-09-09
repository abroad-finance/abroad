// src/ioc.ts
import { Container, decorate, injectable } from 'inversify'
import { Controller } from 'tsoa'

import { ConversionController } from './controllers/ConversionController'
import { PartnerController } from './controllers/PartnerController'
import { PartnerUserController } from './controllers/PartnerUserController'
import { PaymentsController } from './controllers/PaymentsController'
import { QrDecoderController } from './controllers/QrDecoderController'
import { BinanceBalanceUpdatedController } from './controllers/queue/BinanceBalanceUpdatedController'
import { PaymentSentController } from './controllers/queue/PaymentSentController'
import { PaymentStatusUpdatedController } from './controllers/queue/PaymentStatusUpdatedController'
import { ReceivedCryptoTransactionController } from './controllers/queue/ReceivedCryptoTransactionController'
import { QuoteController } from './controllers/QuoteController'
import { TransactionController } from './controllers/TransactionController'
import { TransactionsController } from './controllers/TransactionsController'
import { WalletAuthController } from './controllers/WalletAuthController'
import { WebhookController } from './controllers/WebhookController'
import { CachedSecretManager } from './environment'
import { PrismaClientProvider } from './infrastructure/db'
import { GCPPubSubQueueHandler } from './infrastructure/gcpPubSubQueueHandler'
import { ILogger, IPartnerService, IQueueHandler, ISlackNotifier } from './interfaces'
import { IDatabaseClientProvider } from './interfaces/IDatabaseClientProvider'
import { IExchangeProvider } from './interfaces/IExchangeProvider'
import { IExchangeProviderFactory } from './interfaces/IExchangeProviderFactory'
import { IKycService } from './interfaces/IKycService'
import { IPaymentService } from './interfaces/IPaymentService'
import { IPaymentServiceFactory } from './interfaces/IPaymentServiceFactory'
import { IPixQrDecoder } from './interfaces/IQrDecoder'
import { ISecretManager } from './interfaces/ISecretManager'
import { IWalletHandler } from './interfaces/IWalletHandler'
import { IWalletHandlerFactory } from './interfaces/IWalletHandlerFactory'
import { IWebhookNotifier } from './interfaces/IWebhookNotifier'
import { IWebSocketService } from './interfaces/IWebSocketService'
import { ConsoleLogger } from './services/consoleLogger'
import { ExchangeProviderFactory } from './services/ExchangeProviderFactory'
import { BinanceExchangeProvider } from './services/exchangeProviders/binanceExchangeProvider'
import { TransferoExchangeProvider } from './services/exchangeProviders/transferoExchangeProvider'
import { PartnerService } from './services/partnerService'
import { PaymentServiceFactory } from './services/PaymentServiceFactory'
import { MoviiPaymentService } from './services/paymentServices/movii'
import { NequiPaymentService } from './services/paymentServices/nequi'
import { TransferoPaymentService } from './services/paymentServices/transferoPaymentService'
import { PersonaKycService } from './services/PersonaKycService'
import { PixQrDecoder } from './services/PixQrDecoder'
import { SlackNotifier } from './services/slackNotifier'
import { SocketIOWebSocketService } from './services/SocketIOWebSocketService'
import { SolanaWalletHandler } from './services/SolanaWalletHandler'
import { StellarWalletHandler } from './services/StellarWalletHandler'
import { WalletHandlerFactory } from './services/WalletHandlerFactory'
import { WebhookNotifier } from './services/WebhookNotifier'
import { TYPES } from './types'
import { QuoteUseCase } from './useCases/quoteUseCase'

const container = new Container()

decorate(injectable(), Controller)

// IQueueHandler
container
  .bind<IQueueHandler>(TYPES.IQueueHandler)
  .to(GCPPubSubQueueHandler)
  .inSingletonScope()

// Queue Controllers
container
  .bind<ReceivedCryptoTransactionController>(TYPES.ReceivedCryptoTransactionController)
  .to(ReceivedCryptoTransactionController)
  .inSingletonScope()
container.bind<PaymentSentController>(TYPES.PaymentSentController).to(PaymentSentController).inSingletonScope()
container
  .bind<PaymentStatusUpdatedController>(TYPES.PaymentStatusUpdatedController)
  .to(PaymentStatusUpdatedController)
  .inSingletonScope()
container
  .bind<BinanceBalanceUpdatedController>(TYPES.BinanceBalanceUpdatedController)
  .to(BinanceBalanceUpdatedController)
  .inSingletonScope()

// IDatabaseClientProvider
container
  .bind<IDatabaseClientProvider>(TYPES.IDatabaseClientProvider)
  .to(PrismaClientProvider)
  .inSingletonScope()

// IPaymentService
container
  .bind<IPaymentService>(TYPES.IPaymentService)
  .to(MoviiPaymentService)
  .whenNamed('movii')
container
  .bind<IPaymentService>(TYPES.IPaymentService)
  .to(NequiPaymentService)
  .whenNamed('nequi')
container.bind<IPaymentService>(TYPES.IPaymentService)
  .to(TransferoPaymentService)
  .whenNamed('transfero')

container
  .bind<IPaymentServiceFactory>(TYPES.IPaymentServiceFactory)
  .to(PaymentServiceFactory)

// IExchangeProvider
container
  .bind<IExchangeProvider>(TYPES.IExchangeProvider)
  .to(BinanceExchangeProvider)
  .whenNamed('binance')
container
  .bind<IExchangeProvider>(TYPES.IExchangeProvider)
  .to(TransferoExchangeProvider)
  .whenNamed('transfero')

container
  .bind<IExchangeProviderFactory>(TYPES.IExchangeProviderFactory)
  .to(ExchangeProviderFactory)
  .inSingletonScope()

// ISecretManager
container
  .bind<ISecretManager>(TYPES.ISecretManager)
  .to(CachedSecretManager)
  .inSingletonScope()

// IPartnerService
container
  .bind<IPartnerService>(TYPES.IPartnerService)
  .to(PartnerService)
  .inSingletonScope()

// IKycService
container
  .bind<IKycService>(TYPES.IKycService)
  .to(PersonaKycService)
  .inSingletonScope()

// Controllers
container.bind(WebhookController).toSelf().inSingletonScope()
container.bind<PartnerController>(PartnerController).toSelf().inSingletonScope()
container.bind<PartnerUserController>(PartnerUserController).toSelf().inSingletonScope()
container.bind<ConversionController>(ConversionController).toSelf().inSingletonScope()
container.bind<QuoteController>(QuoteController).toSelf().inSingletonScope()
container
  .bind<TransactionController>(TransactionController)
  .toSelf()
  .inSingletonScope()
container.bind<TransactionsController>(TransactionsController).toSelf().inSingletonScope()
container.bind(PaymentsController).toSelf().inSingletonScope()
container.bind(QrDecoderController).toSelf().inSingletonScope()
container.bind(WalletAuthController).toSelf().inSingletonScope()

// ILogger
container.bind<ILogger>(TYPES.ILogger).to(ConsoleLogger).inSingletonScope()

// ISlackNotifier
container
  .bind<ISlackNotifier>(TYPES.ISlackNotifier)
  .to(SlackNotifier)
  .inSingletonScope()

// IWebSocketService
container
  .bind<IWebSocketService>(TYPES.IWebSocketService)
  .to(SocketIOWebSocketService)
  .inSingletonScope()

// QuoteUseCase
container.bind<QuoteUseCase>(TYPES.QuoteUseCase).to(QuoteUseCase).inSingletonScope()

// Wallet Handlers
container
  .bind<IWalletHandler>(TYPES.SolanaWalletHandler)
  .to(SolanaWalletHandler)
  .inSingletonScope()

container
  .bind<IWalletHandler>(TYPES.StellarWalletHandler)
  .to(StellarWalletHandler)
  .inSingletonScope()

// Wallet Handler Factory
container
  .bind<IWalletHandlerFactory>(TYPES.IWalletHandlerFactory)
  .to(WalletHandlerFactory)
  .inSingletonScope()

// IPixQrDecoder
container
  .bind<IPixQrDecoder>(TYPES.IPixQrDecoder)
  .to(PixQrDecoder)
  .inSingletonScope()

// IWebhookNotifier
container
  .bind<IWebhookNotifier>(TYPES.IWebhookNotifier)
  .to(WebhookNotifier)
  .inSingletonScope()

export { container as iocContainer }
