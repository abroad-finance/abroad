import {
  IExchangeRateProvider,
  ILogger,
  IPartnerService,
  IQueueHandler,
  ISlackNotifier,
} from "./interfaces";
import { BitsoExchangeRateProvider } from "./services/bitsoExchangeRateProvider";
import { Container, decorate, injectable } from "inversify";
import { Controller } from "tsoa";
import { RabbitMQQueueHandler } from "./infrastructure/rabbitmq";
import { StellarTransactionsController } from "./controllers/queue/StellarTransactionsController";
import { TYPES } from "./types";
import { NequiPaymentService } from "./services/nequi";
import { PrismaClientProvider } from "./infrastructure/db";
import { CachedSecretManager } from "./environment";
import { QuoteController } from "./controllers/QuoteController";
import { TransactionController } from "./controllers/TransactionController";
import { KycController } from "./controllers/KycController";
import { ISecretManager } from "./interfaces/ISecretManager";
import { IDatabaseClientProvider } from "./interfaces/IDatabaseClientProvider";
import { PartnerService } from "./services/partnerService";
import { ConsoleLogger } from "./services/consoleLogger";
import { SlackNotifier } from "./services/slackNotifier";
import { IPaymentService } from "./interfaces/IPaymentService";
import { MoviiPaymentService } from "./services/movii";
import { IPaymentServiceFactory } from "./interfaces/IPaymentServiceFactory";
import { PaymentServiceFactory } from "./services/PaymentServiceFactory";

const container = new Container();

decorate(injectable(), Controller);

// ISecretManager
container
  .bind<IExchangeRateProvider>(TYPES.IExchangeRateProvider)
  .to(BitsoExchangeRateProvider)
  .inSingletonScope();

// IQueueHandler
container
  .bind<IQueueHandler>(TYPES.IQueueHandler)
  .to(RabbitMQQueueHandler)
  .inSingletonScope();

// StellarTransactionsController
container
  .bind<StellarTransactionsController>(TYPES.StellarTransactionsController)
  .to(StellarTransactionsController)
  .inSingletonScope();

// IDatabaseClientProvider
container
  .bind<IDatabaseClientProvider>(TYPES.IDatabaseClientProvider)
  .to(PrismaClientProvider)
  .inSingletonScope();

// IPaymentService
container
  .bind<IPaymentService>(TYPES.IPaymentService)
  .to(MoviiPaymentService)
  .whenNamed("movii");
container
  .bind<IPaymentService>(TYPES.IPaymentService)
  .to(NequiPaymentService)
  .whenNamed("nequi");

container
  .bind<IPaymentServiceFactory>(TYPES.IPaymentServiceFactory)
  .to(PaymentServiceFactory);

// ISecretManager
container
  .bind<ISecretManager>(TYPES.ISecretManager)
  .to(CachedSecretManager)
  .inSingletonScope();

// IPartnerService
container
  .bind<IPartnerService>(TYPES.IPartnerService)
  .to(PartnerService)
  .inSingletonScope();

// Controllers
container.bind<QuoteController>(QuoteController).toSelf().inSingletonScope();
container
  .bind<TransactionController>(TransactionController)
  .toSelf()
  .inSingletonScope();
container.bind<KycController>(KycController).toSelf().inSingletonScope();

// ILogger
container.bind<ILogger>(TYPES.ILogger).to(ConsoleLogger).inSingletonScope();

// ISlackNotifier
container
  .bind<ISlackNotifier>(TYPES.ISlackNotifier)
  .to(SlackNotifier)
  .inSingletonScope();

export { container as iocContainer };
