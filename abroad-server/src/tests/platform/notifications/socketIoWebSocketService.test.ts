import jwt from 'jsonwebtoken'

import { SocketIOWebSocketService } from '../../../platform/notifications/socketIoWebSocketService'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'
import { createMockLogger } from '../../setup/mockFactories'

const listenMock = jest.fn((port: number, cb: () => void) => cb())
const closeMock = jest.fn((cb: () => void) => cb())
const createServerMock = jest.fn(() => ({ close: closeMock, listen: listenMock }))
const emitMock = jest.fn()
const onMock = jest.fn()
const useMock = jest.fn()
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
    use: useMock,
  })),
}))

const JWT_SECRET = 'test-wallet-secret'

const createSecretManager = (): ISecretManager => ({
  getSecret: jest.fn(async () => JWT_SECRET),
  getSecrets: jest.fn(async () => ({})),
} as unknown as ISecretManager)

/** Drives the io.use() middleware the way socket.io would. */
const runHandshake = async (auth: unknown): Promise<{ error?: Error, socket: Record<string, unknown> }> => {
  const middleware = useMock.mock.calls[0][0] as (
    socket: unknown,
    next: (error?: Error) => void,
  ) => void
  const socket: Record<string, unknown> = { data: {}, handshake: { auth }, join: joinMock }
  let error: Error | undefined
  await new Promise<void>((resolve) => {
    middleware(socket, (err?: Error) => {
      error = err
      resolve()
    })
  })
  return { error, socket }
}

describe('SocketIOWebSocketService', () => {
  const logger = createMockLogger()
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('emits to a user only after start', async () => {
    const service = new SocketIOWebSocketService(logger, createSecretManager())
    service.emitToUser('u1', 'evt', { ok: true })
    expect(toMock).not.toHaveBeenCalled()

    await service.start(1234)

    expect(createServerMock).toHaveBeenCalled()
    expect(listenMock).toHaveBeenCalledWith(1234, expect.any(Function))
    expect(onMock).toHaveBeenCalledWith('connection', expect.any(Function))

    service.emitToUser('u1', 'evt', { ok: true })
    expect(toMock).toHaveBeenCalledWith('user:u1')
    expect(emitMock).toHaveBeenCalledWith('evt', { ok: true })
  })

  it('joins the room named by the verified token subject', async () => {
    const service = new SocketIOWebSocketService(logger, createSecretManager())
    await service.start(1234)

    const token = jwt.sign({ sub: 'celo:0xabc' }, JWT_SECRET)
    const { error, socket } = await runHandshake({ token })
    expect(error).toBeUndefined()

    const connectionHandler = onMock.mock.calls[0][1]
    connectionHandler(socket)
    expect(joinMock).toHaveBeenCalledWith('user:celo:0xabc')
  })

  it('rejects a handshake that merely asserts a user id', async () => {
    const service = new SocketIOWebSocketService(logger, createSecretManager())
    await service.start(1234)

    // The old contract: a bare userId. A wallet address is public, so honouring
    // this let anyone read anyone else's transaction stream.
    const { error } = await runHandshake({ userId: 'celo:0xvictim' })

    expect(error).toEqual(new Error('unauthorized'))
    expect(joinMock).not.toHaveBeenCalled()
  })

  it('rejects a token signed with the wrong secret', async () => {
    const service = new SocketIOWebSocketService(logger, createSecretManager())
    await service.start(1234)

    const forged = jwt.sign({ sub: 'celo:0xvictim' }, 'not-the-secret')
    const { error } = await runHandshake({ token: forged })

    expect(error).toEqual(new Error('unauthorized'))
    expect(joinMock).not.toHaveBeenCalled()
  })

  it('rejects an expired token', async () => {
    const service = new SocketIOWebSocketService(logger, createSecretManager())
    await service.start(1234)

    const expired = jwt.sign({ sub: 'celo:0xabc' }, JWT_SECRET, { expiresIn: '-1s' })
    const { error } = await runHandshake({ token: expired })

    expect(error).toEqual(new Error('unauthorized'))
  })

  it('rejects a handshake with no credentials at all', async () => {
    const service = new SocketIOWebSocketService(logger, createSecretManager())
    await service.start(1234)

    const { error } = await runHandshake({})

    expect(error).toEqual(new Error('unauthorized'))
  })

  it('stops idempotently and clears listeners', async () => {
    const service = new SocketIOWebSocketService(logger, createSecretManager())
    await service.start(4321)
    await service.stop()

    expect(closeMock).toHaveBeenCalled()
    expect(removeAllListenersMock).toHaveBeenCalled()

    // Second stop should be a no-op
    await service.stop()
    expect(closeMock).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on start', async () => {
    const service = new SocketIOWebSocketService(logger, createSecretManager())
    await service.start(9999)

    // Start again should return early without new listeners
    await service.start(9999)
    expect(listenMock).toHaveBeenCalledTimes(1)

    // emit without payload should default to empty object
    service.emitToUser('u2', 'evt')
    expect(emitMock).toHaveBeenCalledWith('evt', {})
  })
})
