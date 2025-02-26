// In your inversify configuration file (e.g., src/inversify/ioc.ts)
import { IExchangeRateProvider } from "./interfaces";
import { BitsoExchangeRateProvider } from "./services/bitsoExchangeRateProvider";
import { Container, decorate, injectable } from "inversify";
import { buildProviderModule } from "inversify-binding-decorators";
import { Controller } from "tsoa";

const container = new Container();
container.bind<IExchangeRateProvider>("IExchangeRateProvider").to(BitsoExchangeRateProvider);

decorate(injectable(), Controller);

container.load(buildProviderModule());

export { container as iocContainer };
