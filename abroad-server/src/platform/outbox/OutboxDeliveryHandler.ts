import type { OutboxRecord } from './OutboxRepository'

export interface OutboxDeliveryHandler {
  deliver(record: OutboxRecord): Promise<void>
  readonly kind: string
}

export class OutboxDeliveryError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'OutboxDeliveryError'
  }
}
