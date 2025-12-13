import { createServer, Server as HttpServer } from 'http'
import { inject, injectable } from 'inversify'
import { Server as IOServer } from 'socket.io'
import { z } from 'zod'

import { TYPES } from '../../app/container/types'
import { ILogger } from '../../core/logging/types'
import { IWebSocketService } from './IWebSocketService'

@injectable()
export class SocketIOWebSocketService implements IWebSocketService {
  private httpServer?: HttpServer
  private io?: IOServer
  private port = 8080

  constructor(@inject(TYPES.ILogger) private readonly logger: ILogger) {}

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

    // Join a per-user room automatically on connect
    this.io.on('connection', (socket) => {
      const parsed = z
        .object({ userId: z.string().min(1).optional() })
        .safeParse(socket.handshake.auth)
      const userId = parsed.success ? parsed.data.userId : undefined
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
}
