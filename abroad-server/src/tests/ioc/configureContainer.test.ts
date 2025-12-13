describe('configureContainer', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('decorates controllers and wires all binding groups', async () => {
    const decorate = jest.fn()
    const injectable = jest.fn(() => 'injectable')
    const bindInfrastructure = jest.fn()
    const bindDomainServices = jest.fn()
    const bindQueueControllers = jest.fn()
    const bindHttpControllers = jest.fn()

    jest.doMock('inversify', () => {
      class MockContainer {
        public bind = jest.fn(() => ({
          to: jest.fn(() => ({ whenNamed: jest.fn() })),
          toConstantValue: jest.fn(),
          toSelf: jest.fn(() => ({ whenNamed: jest.fn() })),
        }))
      }
      return {
        Container: MockContainer,
        decorate,
        injectable,
      }
    })
    jest.doMock('../../app/container/controllerBindings', () => ({ __esModule: true, bindHttpControllers }))
    jest.doMock('../../app/container/domainBindings', () => ({ __esModule: true, bindDomainServices }))
    jest.doMock('../../app/container/infrastructureBindings', () => ({ __esModule: true, bindInfrastructure }))
    jest.doMock('../../app/container/queueBindings', () => ({ __esModule: true, bindQueueControllers }))

    const { configureContainer } = await import('../../app/container/configureContainer')
    const { Container } = await import('inversify')
    const container = new Container()

    configureContainer(container as unknown as import('inversify').Container)

    expect(decorate).toHaveBeenCalled()
    expect(bindInfrastructure).toHaveBeenCalledWith(container)
    expect(bindDomainServices).toHaveBeenCalledWith(container)
    expect(bindQueueControllers).toHaveBeenCalledWith(container)
    expect(bindHttpControllers).toHaveBeenCalledWith(container)
  })
})
