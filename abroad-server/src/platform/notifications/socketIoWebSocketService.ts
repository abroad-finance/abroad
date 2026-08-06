import { createServer, Server as HttpServer } from 'http'
import { inject, injectable } from 'inversify'
import jwt from 'jsonwebtoken'
import { Server as IOServer } from 'socket.io'
import { z } from 'zod'

import { TYPES } from '../../app/container/types'
import { ILogger } from '../../core/logging/types'
import { ISecretManager } from '../secrets/ISecretManager'
import { IWebSocketService } from './IWebSocketService'

const walletTokenSchema = z.object({
  sub: z.string().min(1),
})

@injectable()
export class SocketIOWebSocketService implements IWebSocketService {
  private httpServer?: HttpServer
  private io?: IOServer
  private port = 8080

  constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
  ) {}

  emitToUser(userId: string, event: string, payload?: unknown): void {
    if (!this.io) {
      this.logger.warn('[ws] emit called before server started')
      return
    }
    this.io.to(`user:${userId}`).emit(event, payload ?? {})
  }

  async start(port?: number): Promise<void> {
    if (this.io) return // already started
    this.port = Number(port ?? process.env.WS_PORT ?? 4000)
    this.httpServer = createServer()
    this.io = new IOServer(this.httpServer, { cors: { origin: '*' } })

    // The room key is a wallet address, which is public: trusting a
    // client-asserted userId let anyone read any user's transaction stream just
    // by knowing their address. The room is now derived from the subject of a
    // verified wallet JWT — the same token and secret the REST API requires, so
    // no client that can create a transaction loses the ability to watch it.
    this.io.use((socket, next) => {
      void this.resolveUserId(socket.handshake.auth)
        .then((userId) => {
          if (!userId) {
            next(new Error('unauthorized'))
            return
          }
          socket.data.userId = userId
          next()
        })
        .catch(() => next(new Error('unauthorized')))
    })

    this.io.on('connection', (socket) => {
      const userId = socket.data.userId as string | undefined
      if (userId) socket.join(`user:${userId}`)
    })

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.port, () => {
        this.logger.info(`[ws] listening on :${this.port}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve()
      this.httpServer.close(() => resolve())
    })
    this.io?.removeAllListeners()
    this.io = undefined
    this.httpServer = undefined
  }

  private async resolveUserId(auth: unknown): Promise<null | string> {
    const parsed = z
      .object({ token: z.string().min(1).optional() })
      .safeParse(auth)
    const token = parsed.success ? parsed.data.token : undefined
    if (!token) {
      return null
    }

    try {
      const secret = await this.secretManager.getSecret('STELLAR_SEP_JWT_SECRET')
      const decoded = walletTokenSchema.safeParse(jwt.verify(token, secret))
      return decoded.success ? decoded.data.sub : null
    }
    catch {
      return null
    }
  }
}
