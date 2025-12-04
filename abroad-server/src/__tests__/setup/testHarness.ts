import type http from 'http'

export type ProcessExitMock = {
  exitSpy: jest.SpyInstance<never, [code?: null | number | string | undefined]>
  restore: () => void
}

type RequestHandler<Req, Res> = (req: Req, res: Res) => void

export const mockProcessExit = (): ProcessExitMock => {
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: null | number | string | undefined) => {
    void code
    return undefined as never
  }) as () => never)

  return {
    exitSpy,
    restore: () => exitSpy.mockRestore(),
  }
}

export const getLastProcessListener = (signal: NodeJS.Signals): ((signal: NodeJS.Signals) => Promise<unknown> | void) | undefined => {
  const listeners = process.listeners(signal)
  const candidate = listeners[listeners.length - 1]
  return typeof candidate === 'function' ? candidate as (signal: NodeJS.Signals) => Promise<unknown> | void : undefined
}

export const flushAsyncOperations = async (): Promise<void> =>
  new Promise(resolve => setImmediate(() => resolve()))

export type ResponseRecorder<Chunk extends string = string> = {
  body: Chunk[]
  res: {
    end: (chunk?: Chunk) => void
    setHeader: jest.Mock<void, [string, string]>
    statusCode: number
  }
}

export const createResponseRecorder = <Chunk extends string = string>(): ResponseRecorder<Chunk> => {
  const body: Chunk[] = []
  const res = {
    end: (chunk?: Chunk) => {
      if (chunk !== undefined) {
        body.push(chunk)
      }
    },
    setHeader: jest.fn<void, [string, string]>(),
    statusCode: 0,
  }

  return { body, res }
}

export const toServerResponse = <Chunk extends string>(res: ResponseRecorder<Chunk>['res']): http.ServerResponse =>
  res as unknown as http.ServerResponse

export const toIncomingMessage = (req: { url?: string }): http.IncomingMessage =>
  req as unknown as http.IncomingMessage

export type HttpServerRecorder<Req, Res> = {
  getHandler: () => RequestHandler<Req, Res> | undefined
  listenMock: jest.Mock<unknown, [number, (() => void)?]>
  mockImplementation: () => { createServer: (handler: RequestHandler<Req, Res>) => { listen: jest.Mock<unknown, [number, (() => void)?]> } }
  reset: () => void
}

export const createHttpServerRecorder = <Req, Res>(): HttpServerRecorder<Req, Res> => {
  let handler: RequestHandler<Req, Res> | undefined
  const listenMock = jest.fn((_: number, cb?: () => void) => {
    cb?.()
    return undefined
  })

  return {
    getHandler: () => handler,
    listenMock,
    mockImplementation: () => ({
      createServer: (incoming: RequestHandler<Req, Res>) => {
        handler = incoming
        return { listen: listenMock }
      },
    }),
    reset: () => {
      handler = undefined
      listenMock.mockReset()
    },
  }
}
