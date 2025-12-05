import type { Container } from 'inversify'

describe('ioc root container', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('creates a singleton-scoped container and configures bindings', async () => {
    const configureContainer = jest.fn()

    jest.doMock('../../ioc/configureContainer', () => ({
      __esModule: true,
      configureContainer,
    }))

    let exportedContainer: Container | undefined

    await jest.isolateModulesAsync(async () => {
      const module = await import('../../ioc')
      exportedContainer = module.iocContainer
    })

    expect(exportedContainer).toBeDefined()
    expect(configureContainer).toHaveBeenCalledTimes(1)
    expect(configureContainer).toHaveBeenCalledWith(exportedContainer)
  })
})
