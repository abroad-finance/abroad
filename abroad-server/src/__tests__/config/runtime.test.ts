import 'reflect-metadata'

describe('RuntimeConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  const importConfig = async () => {
    jest.resetModules()
    const { RuntimeConfig } = await import('../../config/runtime')
    return RuntimeConfig
  }

  it('applies numeric environment overrides when valid', async () => {
    process.env.PUBSUB_ACK_DEADLINE_SECONDS = '45'
    process.env.WS_PORT = '9090'
    const config = await importConfig()

    expect(config.pubSub.ackDeadlineSeconds).toBe(45)
    expect(config.websocket.port).toBe(9090)
  })

  it('falls back to defaults when overrides are missing or invalid', async () => {
    process.env.PUBSUB_ACK_DEADLINE_SECONDS = '-1'
    delete process.env.WS_PORT
    const config = await importConfig()

    expect(config.pubSub.ackDeadlineSeconds).toBe(30)
    expect(config.websocket.port).toBe(8080)
  })
})
