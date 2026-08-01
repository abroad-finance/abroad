import type { Container } from 'inversify'

import { bindHttpControllers } from '../../../app/container/controllerBindings'
import { OpsOverviewController } from '../../../modules/operations/interfaces/http/OpsOverviewController'

describe('controllerBindings', () => {
  it('registers the operations overview controller for generated routes', () => {
    const toSelf = jest.fn(() => ({ whenNamed: jest.fn() }))
    const container = {
      bind: jest.fn(() => ({ toSelf })),
    } as unknown as Container

    bindHttpControllers(container)

    expect(container.bind).toHaveBeenCalledWith(OpsOverviewController)
    expect(toSelf).toHaveBeenCalled()
  })
})
