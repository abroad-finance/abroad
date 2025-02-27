// In your inversify configuration file (e.g., src/inversify/ioc.ts)
import { IExchangeRateProvider, IQueueHandler } from "./interfaces";
import { BitsoExchangeRateProvider } from "./services/bitsoExchangeRateProvider";
import { Container, decorate, injectable } from "inversify";
import { buildProviderModule } from "inversify-binding-decorators";
import { Controller } from "tsoa";
import { RabbitMQQueueHandler } from "./infrastructure/rabbitmq";

export const TYPES = {
  IQueueHandler: Symbol.for("IQueueHandler"),
  IExchangeRateProvider: Symbol.for("IExchangeRateProvider"),
};

const container = new Container();
container
  .bind<IExchangeRateProvider>(TYPES.IExchangeRateProvider)
  .to(BitsoExchangeRateProvider)
  .inSingletonScope();
container
  .bind<IQueueHandler>(TYPES.IQueueHandler)
  .to(RabbitMQQueueHandler)
  .inSingletonScope();

decorate(injectable(), Controller);

container.load(buildProviderModule());

export { container as iocContainer };
