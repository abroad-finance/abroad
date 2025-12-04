import 'reflect-metadata'
import type http from 'http'

import {
  createHttpServerRecorder,
  createResponseRecorder,
  getLastProcessListener,
  mockProcessExit,
  toServerResponse,
} from '../setup/testHarness'

const httpServer = createHttpServerRecorder<Partial<http.IncomingMessage>, Partial<http.ServerResponse>>()

jest.mock('http', () => httpServer.mockImplementation())

const startListenersMock = jest.fn()
jest.mock('../../listeners/index', () => ({
  startListeners: startListenersMock,
}))

describe('listeners health server', () => {
  beforeEach(() => {
    jest.resetModules()
    httpServer.reset()
    startListenersMock.mockClear()
  })

  it('responds to health checks and readiness transitions', async () => {
    await import('../../listeners')

    const handler = httpServer.getHandler()
    expect(handler).toBeDefined()
    expect(startListenersMock).toHaveBeenCalled()
    expect(httpServer.listenMock).toHaveBeenCalled()

    const { body: liveChunks, res: resLive } = createResponseRecorder<string>()
    handler?.({ url: '/healthz' }, toServerResponse(resLive))
    expect(resLive.statusCode).toBe(200)
    expect(liveChunks.join('')).toBe('ok')

    const { body: readyChunksInitial, res: resReadyInitial } = createResponseRecorder<string>()
    handler?.({ url: '/readyz' }, toServerResponse(resReadyInitial))
    expect(resReadyInitial.statusCode).toBe(200)
    expect(readyChunksInitial.join('')).toBe('ready')

    // simulate shutdown signal to flip readiness off
    const sigtermHandler = getLastProcessListener('SIGTERM')
    const exitSpy = mockProcessExit()
    await sigtermHandler?.('SIGTERM')
    const { body: readyChunksAfterStop, res: resReadyAfterStop } = createResponseRecorder<string>()
    handler?.({ url: '/readyz' }, toServerResponse(resReadyAfterStop))
    expect(resReadyAfterStop.statusCode).toBe(503)
    expect(readyChunksAfterStop.join('')).toBe('not ready')
    exitSpy.restore()
  })

  it('returns 404 for unknown paths', async () => {
    await import('../../listeners')

    const handler = httpServer.getHandler()
    const { body, res } = createResponseRecorder<string>()
    handler?.({ url: '/unknown' }, toServerResponse(res))
    expect(res.statusCode).toBe(404)
    expect(body.join('')).toBe('not found')
  })
})
