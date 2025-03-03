import { IExchangeRateProvider, IPaymentService, IQueueHandler } from "./interfaces";
import { BitsoExchangeRateProvider } from "./services/bitsoExchangeRateProvider";
import { Container, decorate, injectable } from "inversify";
import { buildProviderModule } from "inversify-binding-decorators";
import { Controller } from "tsoa";
import { RabbitMQQueueHandler } from "./infrastructure/rabbitmq";
import { StellarTransactionsController } from "./controllers/queue/StellarTransactionsController";
import { TYPES } from "./types";
import { NequiPaymentService } from "./services/nequi";
import { IDatabaseClientProvider, PrismaClientProvider } from "./infrastructure/db";
import { CachedSecretManager, ISecretManager } from "./environment";

const container = new Container();

container
  .bind<IExchangeRateProvider>(TYPES.IExchangeRateProvider)
  .to(BitsoExchangeRateProvider)
  .inSingletonScope();

container
  .bind<IQueueHandler>(TYPES.IQueueHandler)
  .to(RabbitMQQueueHandler)
  .inSingletonScope();

container
  .bind<StellarTransactionsController>(TYPES.StellarTransactionsController)
  .to(StellarTransactionsController)
  .inSingletonScope();

container
  .bind<IDatabaseClientProvider>(TYPES.IDatabaseClientProvider)
  .to(PrismaClientProvider)
  .inRequestScope();

container.bind<IPaymentService>(TYPES.IPaymentService).to(NequiPaymentService).inSingletonScope()

// ISecretManager
container.bind<ISecretManager>(TYPES.ISecretManager).to(CachedSecretManager).inSingletonScope();

decorate(injectable(), Controller);

container.load(buildProviderModule());

export { container as iocContainer };
