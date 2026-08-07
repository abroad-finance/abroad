import 'reflect-metadata'

describe('RuntimeConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  const importConfig = async () => {
    jest.resetModules()
    const { RuntimeConfig } = await import('../../../app/config/runtime')
    return RuntimeConfig
  }

  it('applies numeric environment overrides when valid', async () => {
    process.env.PUBSUB_ACK_DEADLINE_SECONDS = '45'
    process.env.WS_PORT = '9090'
    process.env.SECRET_CACHE_TTL_MS = '120000'
    const config = await importConfig()

    expect(config.pubSub.ackDeadlineSeconds).toBe(45)
    expect(config.websocket.port).toBe(9090)
    expect(config.secrets.cacheTtlMs).toBe(120_000)
  })

  it('falls back to defaults when overrides are missing or invalid', async () => {
    process.env.PUBSUB_ACK_DEADLINE_SECONDS = '-1'
    delete process.env.WS_PORT
    process.env.SECRET_CACHE_TTL_MS = 'not-a-number'
    const config = await importConfig()

    expect(config.pubSub.ackDeadlineSeconds).toBe(30)
    expect(config.websocket.port).toBe(8080)
    expect(config.secrets.cacheTtlMs).toBe(300_000)
  })

  // Ultra's rate limit is account-wide, so this must stay off unless a
  // provisioning job asks for it. Defaulting on burns quota per instance boot.
  it('leaves the Ultra webhook check off unless explicitly enabled', async () => {
    delete process.env.TRANSFERO_ULTRA_VERIFY_WEBHOOK_ON_BOOT
    expect((await importConfig()).transfero.verifyWebhookOnBoot).toBe(false)

    process.env.TRANSFERO_ULTRA_VERIFY_WEBHOOK_ON_BOOT = 'false'
    expect((await importConfig()).transfero.verifyWebhookOnBoot).toBe(false)

    process.env.TRANSFERO_ULTRA_VERIFY_WEBHOOK_ON_BOOT = 'true'
    expect((await importConfig()).transfero.verifyWebhookOnBoot).toBe(true)
  })
})
