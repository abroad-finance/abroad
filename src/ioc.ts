// src/ioc.ts
import { Container, decorate, injectable } from 'inversify'
import { Controller } from 'tsoa'

import { KycController } from './controllers/KycController'
import { PaymentsController } from './controllers/PaymentsController'
import { StellarTransactionsController } from './controllers/queue/StellarTransactionsController'
import { QuoteController } from './controllers/QuoteController'
import { TransactionController } from './controllers/TransactionController'
import { CachedSecretManager } from './environment'
import { PrismaClientProvider } from './infrastructure/db'
import { RabbitMQQueueHandler } from './infrastructure/rabbitmq'
import {
  IExchangeRateProvider,
  ILogger,
  IPartnerService,
  IQueueHandler,
  ISlackNotifier,
} from './interfaces'
import { IDatabaseClientProvider } from './interfaces/IDatabaseClientProvider'
import { IKycService } from './interfaces/IKycService'
import { IPaymentService } from './interfaces/IPaymentService'
import { IPaymentServiceFactory } from './interfaces/IPaymentServiceFactory'
import { ISecretManager } from './interfaces/ISecretManager'
import { BitsoExchangeRateProvider } from './services/bitsoExchangeRateProvider'
import { ConsoleLogger } from './services/consoleLogger'
import { MoviiPaymentService } from './services/movii'
import { NequiPaymentService } from './services/nequi'
import { PartnerService } from './services/partnerService'
import { PaymentServiceFactory } from './services/PaymentServiceFactory'
import { PersonaKycService } from './services/personaKycService'
import { SlackNotifier } from './services/slackNotifier'
import { TYPES } from './types'
import { QuoteUseCase } from './useCases/quoteUseCase'

const container = new Container()

decorate(injectable(), Controller)

// ISecretManager
container
  .bind<IExchangeRateProvider>(TYPES.IExchangeRateProvider)
  .to(BitsoExchangeRateProvider)
  .inSingletonScope()

// IQueueHandler
container
  .bind<IQueueHandler>(TYPES.IQueueHandler)
  .to(RabbitMQQueueHandler)
  .inSingletonScope()

// StellarTransactionsController
container
  .bind<StellarTransactionsController>(TYPES.StellarTransactionsController)
  .to(StellarTransactionsController)
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

export { container as iocContainer }
