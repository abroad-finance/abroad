import { TYPES } from '../../../../app/container/types'
import { createHealthHandler, startOutboxWorker, stopOutboxWorker } from '../../../../app/workers/outbox/server'
import { OutboxRepository } from '../../../../platform/outbox/OutboxRepository'
import { createResponseRecorder, flushAsyncOperations, toIncomingMessage, toServerResponse } from '../../../setup/testHarness'

jest.mock('../../../../app/container', () => {
  const baseLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const worker = {
    start: jest.fn(),
    stop: jest.fn(async () => {}),
  }
  const repository = {
    summarizeFailures: jest.fn(async () => ({ delivering: 0, failed: 0, pending: 0 })),
  }
  const mockGet = jest.fn((token: unknown) => {
    if (token === TYPES.ILogger) return baseLogger
    if (token === TYPES.OutboxWorker) return worker
    if (token === OutboxRepository) return repository
    return {}
  })
  return {
    __baseLogger: baseLogger,
    __mockGet: mockGet,
    __repository: repository,
    __worker: worker,
    iocContainer: {
      get: (token: unknown) => mockGet(token),
    },
  }
})

const {
  __baseLogger: baseLogger,
  __mockGet: getMock,
  __repository: repository,
  __worker: worker,
} = jest.requireMock('../../../../app/container') as {
  __baseLogger: ReturnType<typeof jest.fn> & { error: jest.Mock, info: jest.Mock, warn: jest.Mock }
  __mockGet: jest.Mock
  __repository: { summarizeFailures: jest.Mock }
  __worker: { start: jest.Mock, stop: jest.Mock }
}

describe('outbox worker entrypoint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getMock.mockImplementation((token: unknown) => {
      switch (token) {
        case OutboxRepository:
          return repository
        case TYPES.ILogger:
          return baseLogger
        case TYPES.OutboxWorker:
          return worker
        default:
          throw new Error(`Unexpected dependency token: ${String(token)}`)
      }
    })
  })

  afterEach(async () => {
    await stopOutboxWorker()
  })

  it('exposes health and readiness endpoints and toggles stats availability', async () => {
    const healthState = { live: true, ready: false }
    const handler = createHealthHandler(healthState)

    const { body: liveBody, res: liveRes } = createResponseRecorder<string>()
    handler(toIncomingMessage({ url: '/healthz' }), toServerResponse(liveRes))
    expect(liveRes.statusCode).toBe(200)
    expect(liveBody.join('')).toBe('ok')

    const { body: readyBody, res: readyRes } = createResponseRecorder<string>()
    handler(toIncomingMessage({ url: '/readyz' }), toServerResponse(readyRes))
    expect(readyRes.statusCode).toBe(503)
    expect(readyBody.join('')).toBe('not ready')

    startOutboxWorker()
    expect(worker.start).toHaveBeenCalled()

    healthState.ready = true
    repository.summarizeFailures.mockResolvedValueOnce({ delivering: 1, failed: 2, pending: 3 })

    const { body: statsBody, res: statsRes } = createResponseRecorder<string>()
    handler(toIncomingMessage({ url: '/stats' }), toServerResponse(statsRes))
    await flushAsyncOperations()
    expect(statsRes.statusCode).toBe(200)
    expect(JSON.parse(statsBody.join(''))).toEqual({ delivering: 1, failed: 2, pending: 3 })

    await stopOutboxWorker()

    const { body: statsAfterStopBody, res: statsAfterStopRes } = createResponseRecorder<string>()
    handler(toIncomingMessage({ url: '/stats' }), toServerResponse(statsAfterStopRes))
    await flushAsyncOperations()
    expect(statsAfterStopRes.statusCode).toBe(503)
    expect(statsAfterStopBody.join('')).toBe('outbox not ready')
  })

  it('handles unknown routes and stats failures gracefully', async () => {
    const state = { live: true, ready: true }
    const handler = createHealthHandler(state)

    repository.summarizeFailures.mockRejectedValueOnce(new Error('boom'))
    startOutboxWorker()

    const { body: statsBody, res: statsRes } = createResponseRecorder<string>()
    handler(toIncomingMessage({ url: '/stats' }), toServerResponse(statsRes))
    await flushAsyncOperations()
    expect(baseLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to serve /stats'), expect.any(Error))
    expect(statsRes.statusCode).toBe(500)
    expect(statsBody.join('')).toBe('error')

    const { body: unknownBody, res: unknownRes } = createResponseRecorder<string>()
    handler(toIncomingMessage({ url: '/unknown' }), toServerResponse(unknownRes))
    expect(unknownRes.statusCode).toBe(404)
    expect(unknownBody.join('')).toBe('not found')
  })
})
