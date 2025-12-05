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

    jest.doMock('inversify', () => ({
      Container: class MockContainer { },
      decorate,
      injectable,
    }))
    jest.doMock('../../ioc/controllerBindings', () => ({ __esModule: true, bindHttpControllers }))
    jest.doMock('../../ioc/domainBindings', () => ({ __esModule: true, bindDomainServices }))
    jest.doMock('../../ioc/infrastructureBindings', () => ({ __esModule: true, bindInfrastructure }))
    jest.doMock('../../ioc/queueBindings', () => ({ __esModule: true, bindQueueControllers }))

    const { configureContainer } = await import('../../ioc/configureContainer')
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
