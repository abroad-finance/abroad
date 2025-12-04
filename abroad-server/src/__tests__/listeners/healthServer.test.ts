import 'reflect-metadata'
import type http from 'http'

let recordedHandler: ((req: Partial<http.IncomingMessage>, res: Partial<http.ServerResponse>) => void) | undefined

const listenMock = jest.fn((_: number, cb?: () => void) => {
  cb?.()
  return undefined
})

jest.mock('http', () => ({
  createServer: (handler: typeof recordedHandler) => {
    recordedHandler = handler
    return {
      listen: listenMock,
    }
  },
}))

const startListenersMock = jest.fn()
jest.mock('../../listeners/index', () => ({
  startListeners: startListenersMock,
}))

const buildResponse = () => {
  const chunks: string[] = []
  const res: Partial<http.ServerResponse> = {
    end: (chunk?: unknown) => {
      if (typeof chunk === 'string') {
        chunks.push(chunk)
      }
      return res as http.ServerResponse
    },
    setHeader: jest.fn(),
    statusCode: 0,
  }
  return { chunks, res }
}

describe('listeners health server', () => {
  beforeEach(() => {
    jest.resetModules()
    recordedHandler = undefined
    listenMock.mockClear()
    startListenersMock.mockClear()
  })

  it('responds to health checks and readiness transitions', async () => {
    await import('../../listeners')

    expect(recordedHandler).toBeDefined()
    expect(startListenersMock).toHaveBeenCalled()
    expect(listenMock).toHaveBeenCalled()

    const { chunks: liveChunks, res: resLive } = buildResponse()
    recordedHandler?.({ url: '/healthz' }, resLive)
    expect(resLive.statusCode).toBe(200)
    expect(liveChunks.join('')).toBe('ok')

    const { chunks: readyChunksInitial, res: resReadyInitial } = buildResponse()
    recordedHandler?.({ url: '/readyz' }, resReadyInitial)
    expect(resReadyInitial.statusCode).toBe(200)
    expect(readyChunksInitial.join('')).toBe('ready')

    // simulate shutdown signal to flip readiness off
    const sigtermHandler = process.listeners('SIGTERM').slice(-1)[0]
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    sigtermHandler?.('SIGTERM' as NodeJS.Signals)
    const { chunks: readyChunksAfterStop, res: resReadyAfterStop } = buildResponse()
    recordedHandler?.({ url: '/readyz' }, resReadyAfterStop)
    expect(resReadyAfterStop.statusCode).toBe(503)
    expect(readyChunksAfterStop.join('')).toBe('not ready')
    exitSpy.mockRestore()
  })

  it('returns 404 for unknown paths', async () => {
    await import('../../listeners')

    const { chunks, res } = buildResponse()
    recordedHandler?.({ url: '/unknown' }, res)
    expect(res.statusCode).toBe(404)
    expect(chunks.join('')).toBe('not found')
  })
})
