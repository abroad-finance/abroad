import { injectable, multiInject, optional } from 'inversify'

import { TYPES } from '../../app/container/types'
import { OutboxDeliveryError, OutboxDeliveryHandler } from './OutboxDeliveryHandler'
import { OutboxRecord } from './OutboxRepository'

@injectable()
export class OutboxDeliveryHandlerRegistry {
  private readonly handlers: ReadonlyMap<string, OutboxDeliveryHandler>

  public constructor(
    @optional()
    @multiInject(TYPES.OutboxDeliveryHandler)
    handlers: OutboxDeliveryHandler[] = [],
  ) {
    const byKind = new Map<string, OutboxDeliveryHandler>()
    for (const handler of handlers) {
      if (!handler.kind.trim() || byKind.has(handler.kind)) {
        throw new Error(`Invalid or duplicate outbox delivery handler: ${handler.kind}`)
      }
      byKind.set(handler.kind, handler)
    }
    this.handlers = byKind
  }

  public async deliver(record: OutboxRecord): Promise<void> {
    const payload = record.payload
    if (
      typeof payload !== 'object'
      || payload === null
      || Array.isArray(payload)
      || !('kind' in payload)
      || typeof payload.kind !== 'string'
    ) {
      throw new OutboxDeliveryError('Outbox payload kind is invalid', false)
    }
    const handler = this.handlers.get(payload.kind)
    if (!handler) {
      throw new OutboxDeliveryError('Outbox delivery handler is not registered', false)
    }
    await handler.deliver(record)
  }
}
