import { Container, decorate, injectable } from 'inversify'
import { Controller } from 'tsoa'

import { bindHttpControllers } from './controllerBindings'
import { bindDomainServices } from './domainBindings'
import { bindInfrastructure } from './infrastructureBindings'
import { bindQueueControllers } from './queueBindings'

export function configureContainer(container: Container): void {
  decorate(injectable(), Controller)
  bindInfrastructure(container)
  bindDomainServices(container)
  bindQueueControllers(container)
  bindHttpControllers(container)
}
