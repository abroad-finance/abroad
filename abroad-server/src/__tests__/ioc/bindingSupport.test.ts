import type { Container } from 'inversify'

import { registerBindings } from '../../ioc/bindingSupport'

describe('registerBindings', () => {
  it('binds implementations and applies names when provided', () => {
    const whenNamed = jest.fn()
    const bindingResult = { whenNamed }
    const container = {
      bind: jest.fn(() => ({
        to: jest.fn(() => bindingResult),
        toSelf: jest.fn(() => bindingResult),
      })),
    } as unknown as Container

    class Example { }

    registerBindings(container, [
      { identifier: 'service', implementation: Example },
      { bindSelf: true, identifier: Example, implementation: Example, name: 'primary' },
    ])

    expect(container.bind).toHaveBeenCalledWith('service')
    expect(container.bind).toHaveBeenCalledWith(Example)
    expect(whenNamed).toHaveBeenCalledWith('primary')
  })
})
