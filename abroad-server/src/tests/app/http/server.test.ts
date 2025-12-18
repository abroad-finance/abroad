import 'reflect-metadata'

import { flushAsyncOperations, mockProcessExit } from '../../setup/testHarness'

type MiddlewareHandler = (req: RequestStub, res: ResponseStub, next?: () => void) => void
type RequestStub = {
  body?: unknown
  get?: (name: string) => string
  headers?: Record<string, string>
  protocol?: string
  url?: string
}
type ResponseStub = {
  end?: (chunk?: string) => void
  format?: (formatters: Record<string, () => void>) => void
  json?: (body: unknown) => void
  redirect?: (location: string) => void
  setHeader?: (name: string, value: string) => void
  status?: (code: number) => { json: (body: unknown) => void }
  statusCode?: number
}
type RouteHandler = (req: RequestStub, res: ResponseStub) => void

const registered: {
  gets: Array<{ handler: RouteHandler, path: string }>
  posts: Array<{ handler: RouteHandler, path: string }>
  uses: Array<{ handler: MiddlewareHandler, path?: string }>
} = { gets: [], posts: [], uses: [] }

const closeResults: Array<Error | undefined> = []
const setCloseResults = (...results: Array<Error | undefined>) => {
  closeResults.splice(0, closeResults.length, ...results)
}

const serverMock = {
  close: jest.fn((cb: (err?: Error) => void) => {
    cb(closeResults.shift())
  }),
}

const appMock = {
  get: jest.fn((path: string, handler: RouteHandler) => {
    registered.gets.push({ handler, path })
  }),
  listen: jest.fn((_port: number, cb?: () => void) => {
    cb?.()
    return serverMock
  }),
  post: jest.fn((path: string, handler: RouteHandler) => {
    registered.posts.push({ handler, path })
  }),
  use: jest.fn((pathOrHandler: MiddlewareHandler | string, maybeHandler?: MiddlewareHandler) => {
    if (typeof pathOrHandler === 'string') {
      registered.uses.push({ handler: maybeHandler!, path: pathOrHandler })
    }
    else {
      registered.uses.push({ handler: pathOrHandler })
    }
  }),
}

const logger = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}

jest.mock('express', () => {
  const expressFn = () => appMock
  ;(expressFn as unknown as { Router: () => typeof appMock }).Router = () => appMock
  return expressFn
})

jest.mock('body-parser', () => ({
  json: jest.fn(() => (_req: unknown, _res: unknown, next?: () => void) => next?.()),
}))

jest.mock('cors', () => jest.fn(() => (_req: unknown, _res: unknown, next?: () => void) => next?.()))

jest.mock('swagger-ui-express', () => ({
  serve: [],
  setup: jest.fn(() => 'swagger-setup'),
}))

jest.mock('../../../app/http/routes', () => ({
  RegisterRoutes: jest.fn(() => undefined),
}))

jest.mock(require.resolve('../../../app/admin/admin'), () => ({
  initAdmin: jest.fn(async () => {
    throw new Error('init-admin-fail')
  }),
}))

jest.mock('../../../app/container', () => ({
  iocContainer: {
    get: jest.fn(() => logger),
  },
}))

jest.mock('fs', () => ({
  readFileSync: jest.fn(() =>
    JSON.stringify({
      paths: {
        '/existing': { post: { tags: ['existing'] } },
        '/foo/bar': { get: {} },
      },
      tags: [{ name: 'existing' }],
    }),
  ),
}))

jest.mock('path', () => ({
  resolve: jest.fn((...args: string[]) => args.join('/')),
}))

describe('server bootstrap', () => {
  const originalEnv = process.env.NODE_ENV
  const originalShutdownTimeout = process.env.SHUTDOWN_TIMEOUT_MS
  const bootstrapServer = async () => {
    const handlers: Record<string, Array<(signal: NodeJS.Signals) => void>> = {}
    const onSpy = jest.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: (signal: NodeJS.Signals) => void) => {
      const key = event.toString()
      if (!handlers[key]) handlers[key] = []
      handlers[key]!.push(listener)
      return process
    })

    jest.resetModules()
    await import('../../../app/http/server')
    await flushAsyncOperations()
    onSpy.mockRestore()

    return { handlers }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    registered.gets.length = 0
    registered.posts.length = 0
    registered.uses.length = 0
    setCloseResults(new Error('close-fail'), undefined)
    process.env.NODE_ENV = 'production'
    process.env.SHUTDOWN_TIMEOUT_MS = originalShutdownTimeout
    logger.error.mockClear()
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  afterAll(() => {
    process.env.NODE_ENV = originalEnv
    process.env.SHUTDOWN_TIMEOUT_MS = originalShutdownTimeout
  })

  it('boots the app, wires health routes, and shuts down once even when signaled twice', async () => {
    setCloseResults(undefined)
    process.env.SHUTDOWN_TIMEOUT_MS = '5'
    const exitMock = mockProcessExit()
    const { handlers } = await bootstrapServer()

    // Ensure routes registered
    const rootRoute = registered.gets.find(r => r.path === '/')
    expect(rootRoute).toBeDefined()

    // Exercise landing route formats
    const responses: Array<{ body: unknown, headers: Record<string, string>, status?: number }> = []
    const resFactory = () => {
      const headers: Record<string, string> = {}
      return {
        format: (fmt: Record<string, () => void>) => {
          Object.values(fmt).forEach(fn => fn())
        },
        json: (body: unknown) => {
          responses.push({ body, headers })
        },
        redirect: (loc: string) => {
          responses.push({ body: `redirect:${loc}`, headers })
        },
        setHeader: (k: string, v: string) => {
          headers[k] = v
        },
        status: (code: number) => ({
          json: (body: unknown) => responses.push({ body, headers, status: code }),
        }),
      }
    }
    rootRoute?.handler({ get: () => 'localhost:3000', protocol: 'http' }, resFactory())

    // Trigger error middleware and graceful shutdown (duplicate signals should not double-close)
    const sigintHandler = handlers.SIGINT?.[0]
    const sigtermHandler = handlers.SIGTERM?.[0]
    expect(sigintHandler).toBeDefined()
    expect(sigtermHandler).toBeDefined()

    await sigintHandler?.('SIGINT')
    await sigtermHandler?.('SIGTERM')
    // Wait longer than the forced shutdown timeout to ensure the fallback timer is cleared
    await new Promise(resolve => setTimeout(resolve, 25))

    expect(appMock.listen).toHaveBeenCalled()
    expect(serverMock.close).toHaveBeenCalledTimes(1)
    expect(exitMock.exitSpy).toHaveBeenCalledTimes(1)
    expect(exitMock.exitSpy).toHaveBeenCalledWith(0)
    expect(logger.warn).toHaveBeenCalledWith('SIGTERM received while shutdown already in progress')
    expect(responses.length).toBeGreaterThan(0)

    // Production error middleware path
    const errorHandler = registered.uses.find(u => u.handler.length === 4)?.handler as (
      err: unknown,
      req: RequestStub,
      res: ResponseStub,
      next?: () => void
    ) => void
    const json = jest.fn()
    const status = jest.fn(() => ({ json }))
    errorHandler?.(new Error('boom'), {}, { status })
    expect(status).toHaveBeenCalledWith(500)
    expect(json).toHaveBeenCalledWith({
      message: 'boom',
      reason: 'boom',
    })

    exitMock.restore()
  })

  it('exits with failure when the HTTP server fails to close', async () => {
    setCloseResults(new Error('close-fail'))
    process.env.SHUTDOWN_TIMEOUT_MS = '5'
    const exitMock = mockProcessExit()
    const { handlers } = await bootstrapServer()
    const sigintHandler = handlers.SIGINT?.[0]
    expect(sigintHandler).toBeDefined()

    await sigintHandler?.('SIGINT')
    await new Promise(resolve => setTimeout(resolve, 15))

    expect(serverMock.close).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('Error during HTTP server close', expect.any(Error))
    expect(exitMock.exitSpy).toHaveBeenCalledWith(1)
    exitMock.restore()
  })
})
