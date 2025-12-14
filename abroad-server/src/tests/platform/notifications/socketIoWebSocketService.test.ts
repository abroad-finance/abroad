import { SocketIOWebSocketService } from '../../../platform/notifications/socketIoWebSocketService'
import { createMockLogger } from '../../setup/mockFactories'

const listenMock = jest.fn((port: number, cb: () => void) => cb())
const closeMock = jest.fn((cb: () => void) => cb())
const createServerMock = jest.fn(() => ({ close: closeMock, listen: listenMock }))
const emitMock = jest.fn()
const onMock = jest.fn()
const removeAllListenersMock = jest.fn()
const joinMock = jest.fn()
const toMock = jest.fn(() => ({ emit: emitMock }))

jest.mock('http', () => ({
  createServer: () => createServerMock(),
}))

jest.mock('socket.io', () => ({
  Server: jest.fn(() => ({
    on: onMock,
    removeAllListeners: removeAllListenersMock,
    to: toMock,
  })),
}))

describe('SocketIOWebSocketService', () => {
  const logger = createMockLogger()
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('emits to a user only after start and joins rooms on connection', async () => {
    const service = new SocketIOWebSocketService(logger)
    service.emitToUser('u1', 'evt', { ok: true })
    expect(toMock).not.toHaveBeenCalled()

    await service.start(1234)

    expect(createServerMock).toHaveBeenCalled()
    expect(listenMock).toHaveBeenCalledWith(1234, expect.any(Function))
    expect(onMock).toHaveBeenCalledWith('connection', expect.any(Function))

    // Simulate handshake auth payload and ensure join is invoked.
    const connectionHandler = onMock.mock.calls[0][1]
    const socket = { handshake: { auth: { userId: 'abc' } }, join: joinMock }
    connectionHandler(socket)
    expect(joinMock).toHaveBeenCalledWith('user:abc')

    service.emitToUser('u1', 'evt', { ok: true })
    expect(toMock).toHaveBeenCalledWith('user:u1')
    expect(emitMock).toHaveBeenCalledWith('evt', { ok: true })
  })

  it('stops idempotently and clears listeners', async () => {
    const service = new SocketIOWebSocketService(logger)
    await service.start(4321)
    await service.stop()

    expect(closeMock).toHaveBeenCalled()
    expect(removeAllListenersMock).toHaveBeenCalled()

    // Second stop should be a no-op
    await service.stop()
    expect(closeMock).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on start and tolerates missing auth/user ids', async () => {
    const service = new SocketIOWebSocketService(logger)
    await service.start(9999)

    // Start again should return early without new listeners
    await service.start(9999)
    expect(listenMock).toHaveBeenCalledTimes(1)

    const connectionHandler = onMock.mock.calls[0][1]
    const socket = { handshake: { auth: {} }, join: joinMock }
    connectionHandler(socket)
    expect(joinMock).not.toHaveBeenCalled()

    // emit without payload should default to empty object
    service.emitToUser('u2', 'evt')
    expect(emitMock).toHaveBeenCalledWith('evt', {})
  })
})
