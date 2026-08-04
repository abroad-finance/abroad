import type { Container } from 'inversify'

import { bindHttpControllers } from '../../../app/container/controllerBindings'
import { OpsAdministrationController } from '../../../modules/operations/interfaces/http/OpsAdministrationController'
import { OpsCasesController } from '../../../modules/operations/interfaces/http/OpsCasesController'
import { OpsConfigurationReleaseController } from '../../../modules/operations/interfaces/http/OpsConfigurationReleaseController'
import { OpsIdentityController } from '../../../modules/operations/interfaces/http/OpsIdentityController'
import { OpsOverviewController } from '../../../modules/operations/interfaces/http/OpsOverviewController'
import { OpsSavedViewsController } from '../../../modules/operations/interfaces/http/OpsSavedViewsController'
import { OpsSearchController } from '../../../modules/operations/interfaces/http/OpsSearchController'
import { ConsumerUxTelemetryController } from '../../../modules/telemetry/interfaces/http/ConsumerUxTelemetryController'
import { ConsumerActivityController } from '../../../modules/transactions/interfaces/http/ConsumerActivityController'

describe('controllerBindings', () => {
  it('registers the operations overview controller for generated routes', () => {
    const toSelf = jest.fn(() => ({ whenNamed: jest.fn() }))
    const container = {
      bind: jest.fn(() => ({ toSelf })),
    } as unknown as Container

    bindHttpControllers(container)

    expect(container.bind).toHaveBeenCalledWith(OpsIdentityController)
    expect(container.bind).toHaveBeenCalledWith(OpsAdministrationController)
    expect(container.bind).toHaveBeenCalledWith(OpsOverviewController)
    expect(container.bind).toHaveBeenCalledWith(OpsCasesController)
    expect(container.bind).toHaveBeenCalledWith(OpsConfigurationReleaseController)
    expect(container.bind).toHaveBeenCalledWith(OpsSavedViewsController)
    expect(container.bind).toHaveBeenCalledWith(OpsSearchController)
    expect(container.bind).toHaveBeenCalledWith(ConsumerUxTelemetryController)
    expect(container.bind).toHaveBeenCalledWith(ConsumerActivityController)
    expect(toSelf).toHaveBeenCalled()
  })
})
