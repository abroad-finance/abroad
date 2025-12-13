import { Container, decorate, injectable } from 'inversify'
import { Controller } from 'tsoa'

import { RuntimeConfig, RuntimeConfiguration } from '../config/runtime'
import { bindHttpControllers } from './controllerBindings'
import { bindDomainServices } from './domainBindings'
import { bindInfrastructure } from './infrastructureBindings'
import { bindQueueControllers } from './queueBindings'
import { TYPES } from './types'

export function configureContainer(container: Container): void {
  decorate(injectable(), Controller)
  container.bind<RuntimeConfiguration>(TYPES.AppConfig).toConstantValue(RuntimeConfig)
  bindInfrastructure(container)
  bindDomainServices(container)
  bindQueueControllers(container)
  bindHttpControllers(container)
}
