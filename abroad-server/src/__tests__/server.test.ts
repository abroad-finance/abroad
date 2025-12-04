import 'reflect-metadata'

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

const closeErrors: Array<Error | undefined> = [new Error('close-fail'), undefined]

const serverMock = {
  close: jest.fn((cb: (err?: Error) => void) => {
    cb(closeErrors.shift())
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

jest.mock('../routes', () => ({
  RegisterRoutes: jest.fn(() => undefined),
}))

jest.mock('../admin/admin', () => ({
  initAdmin: jest.fn(async () => {
    throw new Error('init-admin-fail')
  }),
}))

jest.mock('../ioc', () => ({
  iocContainer: {
    get: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    })),
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

  beforeEach(() => {
    jest.clearAllMocks()
    registered.gets.length = 0
    registered.posts.length = 0
    registered.uses.length = 0
    closeErrors.splice(0, closeErrors.length, new Error('close-fail'), undefined)
    process.env.NODE_ENV = 'production'
  })

  afterAll(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('boots the app, wires health routes, and shuts down gracefully', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const handlers: Record<string, Array<(signal: NodeJS.Signals) => void>> = {}
    const onSpy = jest.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: (signal: NodeJS.Signals) => void) => {
      const key = event.toString()
      if (!handlers[key]) handlers[key] = []
      handlers[key]!.push(listener)
      return process
    })
    jest.isolateModules(async () => {
      await import('../server')
    })
    await new Promise(resolve => setImmediate(resolve))
    onSpy.mockRestore()

    // Ensure routes registered
    const rootRoute = registered.gets.find(r => r.path === '/')
    const moviiRoute = registered.posts.find(r => r.path === '/webhooks/movii')
    expect(rootRoute).toBeDefined()
    expect(moviiRoute).toBeDefined()

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

    // Movii webhook logging path
    moviiRoute?.handler(
      { body: { ok: true }, headers: { foo: 'bar' } },
      {
        json: (body: unknown) => responses.push({ body, headers: {} }),
        status: jest.fn(() => ({ json: (body: unknown) => responses.push({ body, headers: {} }) })),
      },
    )

    // Trigger error middleware and graceful shutdown (first with error, then clean)
    const shutdownHandlers = handlers.SIGINT ?? []
    expect(shutdownHandlers.length).toBeGreaterThan(0)
    for (const handler of shutdownHandlers) {
      await handler('SIGINT')
      await handler('SIGTERM')
    }

    expect(appMock.listen).toHaveBeenCalled()
    expect(serverMock.close).toHaveBeenCalledTimes(2)
    expect(exitSpy).toHaveBeenCalled()
    expect(responses.length).toBeGreaterThan(0)
    exitSpy.mockRestore()
  })
})
