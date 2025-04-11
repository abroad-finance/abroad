// src/ioc.ts
import { Container, decorate, injectable } from 'inversify'
import { Controller } from 'tsoa'

import { KycController } from './controllers/KycController'
import { PaymentsController } from './controllers/PaymentsController'
import { PaymentSentController } from './controllers/queue/PaymentSentController'
import { ReceivedCryptoTransactionController } from './controllers/queue/ReceivedCryptoTransactionController'
import { QuoteController } from './controllers/QuoteController'
import { TransactionController } from './controllers/TransactionController'
import { CachedSecretManager } from './environment'
import { PrismaClientProvider } from './infrastructure/db'
import { RabbitMQQueueHandler } from './infrastructure/rabbitmq'
import { ILogger, IPartnerService, IQueueHandler, ISlackNotifier } from './interfaces'
import { IDatabaseClientProvider } from './interfaces/IDatabaseClientProvider'
import { IExchangeProvider } from './interfaces/IExchangeProvider'
import { IKycService } from './interfaces/IKycService'
import { IPaymentService } from './interfaces/IPaymentService'
import { IPaymentServiceFactory } from './interfaces/IPaymentServiceFactory'
import { ISecretManager } from './interfaces/ISecretManager'
import { IWalletHandler } from './interfaces/IWalletHandler'
import { IWalletHandlerFactory } from './interfaces/IWalletHandlerFactory'
import { BinanceExchangeProvider } from './services/binanceExchangeProvider'
import { ConsoleLogger } from './services/consoleLogger'
import { MoviiPaymentService } from './services/movii'
import { NequiPaymentService } from './services/nequi'
import { PartnerService } from './services/partnerService'
import { PaymentServiceFactory } from './services/PaymentServiceFactory'
import { PersonaKycService } from './services/personaKycService'
import { SlackNotifier } from './services/slackNotifier'
import { SolanaWalletHandler } from './services/SolanaWalletHandler'
import { StellarWalletHandler } from './services/StellarWalletHandler'
import { WalletHandlerFactory } from './services/WalletHandlerFactory'
import { TYPES } from './types'
import { KycUseCase } from './useCases/kycUseCase'
import { QuoteUseCase } from './useCases/quoteUseCase'

const container = new Container()

decorate(injectable(), Controller)

// IExchangeProvider
container
  .bind<IExchangeProvider>(TYPES.IExchangeProvider)
  .to(BinanceExchangeProvider)
  .inSingletonScope()

// IQueueHandler
container
  .bind<IQueueHandler>(TYPES.IQueueHandler)
  .to(RabbitMQQueueHandler)
  .inSingletonScope()

// Queue Controllers
container
  .bind<ReceivedCryptoTransactionController>(TYPES.ReceivedCryptoTransactionController)
  .to(ReceivedCryptoTransactionController)
  .inSingletonScope()
container.bind<PaymentSentController>(TYPES.PaymentSentController).to(PaymentSentController).inSingletonScope()

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

container
  .bind<IPaymentServiceFactory>(TYPES.IPaymentServiceFactory)
  .to(PaymentServiceFactory)

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
container.bind<QuoteController>(QuoteController).toSelf().inSingletonScope()
container
  .bind<TransactionController>(TransactionController)
  .toSelf()
  .inSingletonScope()
container.bind<KycController>(KycController).toSelf().inSingletonScope()
container.bind(PaymentsController).toSelf().inSingletonScope()

// ILogger
container.bind<ILogger>(TYPES.ILogger).to(ConsoleLogger).inSingletonScope()

// ISlackNotifier
container
  .bind<ISlackNotifier>(TYPES.ISlackNotifier)
  .to(SlackNotifier)
  .inSingletonScope()

// QuoteUseCase
container.bind<QuoteUseCase>(TYPES.QuoteUseCase).to(QuoteUseCase).inSingletonScope()

// KycUseCase
container.bind<KycUseCase>(TYPES.KycUseCase).to(KycUseCase).inSingletonScope()

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

export { container as iocContainer }
