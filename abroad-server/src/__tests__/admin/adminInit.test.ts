import type { Express } from 'express'

import { TYPES } from '../../types'

const prismaAdapterMocks: { Database?: unknown, Resource?: unknown } = {
  Database: class Database { },
  Resource: class Resource { },
}

const originalNodeEnv = process.env.NODE_ENV
const originalAdminEmail = process.env.ADMIN_EMAIL
const originalAdminPassword = process.env.ADMIN_PASSWORD
const originalSkipBundle = process.env.ADMIN_JS_SKIP_BUNDLE

beforeEach(() => {
  jest.resetModules()
  prismaAdapterMocks.Database = class Database { }
  prismaAdapterMocks.Resource = class Resource { }
})

afterEach(() => {
  jest.clearAllMocks()
  process.env.NODE_ENV = originalNodeEnv
  process.env.ADMIN_EMAIL = originalAdminEmail
  process.env.ADMIN_PASSWORD = originalAdminPassword
  process.env.ADMIN_JS_SKIP_BUNDLE = originalSkipBundle
})

async function loadInitAdmin() {
  const registerAdapter = jest.fn()
  const initialize = jest.fn()
  const watch = jest.fn()
  const componentLoaderSpy = jest.fn()
  const authRouterGet = jest.fn()
  const buildAuthenticatedRouter = jest.fn(() => ({ get: authRouterGet }))
  const personaSpy = jest.fn()

  jest.doMock('adminjs', () => {
    class MockComponentLoader {
      constructor() {
        componentLoaderSpy()
      }
    }
    class MockAdminJS {
      public options: unknown
      public watch = watch
      public initialize = initialize
      public static registerAdapter = registerAdapter
      public static ComponentLoader = MockComponentLoader
      constructor(options: unknown) {
        this.options = options
      }
    }
    return { __esModule: true, default: MockAdminJS, ComponentLoader: MockComponentLoader }
  }, { virtual: true })

  jest.doMock('@adminjs/express', () => ({
    __esModule: true,
    default: { buildAuthenticatedRouter },
  }), { virtual: true })

  jest.doMock('@adminjs/prisma', () => prismaAdapterMocks, { virtual: true })

  jest.doMock('../../services/PersonaInquiryDetailsService', () => ({
    __esModule: true,
    PersonaInquiryDetailsService: class MockPersona {
      constructor() {
        personaSpy()
      }
    },
  }))

  const quoteSupport = {
    baseResource: { name: 'base' },
    createCsvRouteHandler: jest.fn().mockReturnValue('csv-handler'),
    csvRoute: '/csv',
    detailedResource: { name: 'detailed' },
  }
  jest.doMock('../../admin/transactionQuoteSupport', () => ({
    __esModule: true,
    createTransactionQuoteSupport: () => quoteSupport,
  }))

  const prismaClient = {}
  const dbProvider = { getClient: jest.fn().mockResolvedValue(prismaClient) }
  const secretManager = {}
  const iocContainer = {
    get: jest.fn((token: unknown) => {
      if (token === TYPES.IDatabaseClientProvider) return dbProvider
      if (token === TYPES.ISecretManager) return secretManager
      throw new Error(`Unexpected token ${String(token)}`)
    }),
  }
  jest.doMock('../../ioc', () => ({ __esModule: true, iocContainer }))

  const sessionMiddleware = jest.fn()
  jest.doMock('express-session', () => ({
    __esModule: true,
    default: jest.fn(() => sessionMiddleware),
  }))

  const { initAdmin } = await import('../../admin/admin')
  return {
    authRouterGet,
    buildAuthenticatedRouter,
    dbProvider,
    initAdmin,
    initialize,
    personaSpy,
    quoteSupport,
    registerAdapter,
    watch,
  }
}

describe('initAdmin', () => {
  it('registers adapters, builds router, and initializes AdminJS', async () => {
    process.env.NODE_ENV = 'test'
    const appUse = jest.fn()
    const app = { use: appUse } as unknown as Express
    const { initAdmin, registerAdapter, quoteSupport, authRouterGet, initialize, watch } = await loadInitAdmin()

    await initAdmin(app)

    expect(registerAdapter).toHaveBeenCalledWith(expect.objectContaining({
      Database: prismaAdapterMocks.Database,
      Resource: prismaAdapterMocks.Resource,
    }))
    expect(authRouterGet).toHaveBeenCalledWith(quoteSupport.csvRoute, 'csv-handler')
    expect(appUse).toHaveBeenCalledWith('/admin', expect.objectContaining({ get: authRouterGet }))
    expect(initialize).toHaveBeenCalled()
    expect(watch).not.toHaveBeenCalled()
  })

  it('watches the AdminJS bundle in development', async () => {
    process.env.NODE_ENV = 'development'
    const appUse = jest.fn()
    const app = { use: appUse } as unknown as Express
    const { initAdmin, initialize, watch } = await loadInitAdmin()

    await initAdmin(app)

    expect(watch).toHaveBeenCalled()
    expect(initialize).not.toHaveBeenCalled()
  })

  it('authenticates admin users with configured credentials', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ADMIN_EMAIL = 'admin@test.com'
    process.env.ADMIN_PASSWORD = 'secret'
    const app = { use: jest.fn() } as unknown as Express
    const { initAdmin, buildAuthenticatedRouter } = await loadInitAdmin()

    await initAdmin(app)

    expect(buildAuthenticatedRouter).toHaveBeenCalled()
    const authCall = buildAuthenticatedRouter.mock.calls[0]
    if (!authCall) {
      throw new Error('Authenticated router was not built')
    }
    const [, authConfig] = authCall as unknown as [unknown, { authenticate: (email: string, password: string) => Promise<unknown> }]
    const authenticate = authConfig.authenticate
    await expect(authenticate('admin@test.com', 'secret')).resolves.toEqual({ email: 'admin@test.com' })
    await expect(authenticate('admin@test.com', 'wrong')).resolves.toBeNull()
  })

  it('fails fast when prisma adapter exports are missing', async () => {
    prismaAdapterMocks.Database = undefined
    prismaAdapterMocks.Resource = undefined
    process.env.NODE_ENV = 'production'

    const app = { use: jest.fn() } as unknown as Express
    const { initAdmin } = await loadInitAdmin()

    await expect(initAdmin(app)).rejects.toThrow('Failed to load @adminjs/prisma adapter exports')
  })
})
