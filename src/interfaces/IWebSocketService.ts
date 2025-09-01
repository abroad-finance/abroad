// src/interfaces/IWebSocketService.ts

export interface IWebSocketService {
  /** Emit an event to a specific user room. */
  emitToUser(userId: string, event: string, payload?: unknown): void

  /** Start the WebSocket server on the given port (default from WS_PORT or 4000). */
  start(port?: number): Promise<void>

  /** Gracefully stop the WebSocket server and release resources. */
  stop(): Promise<void>
}
