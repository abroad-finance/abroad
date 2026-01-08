import { TransactionStatus } from '@prisma/client'
import { injectable, multiInject, optional } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IPayoutStatusAdapter } from './contracts/IPayoutStatusAdapter'

@injectable()
export class PayoutStatusAdapterRegistry {
  private readonly adapters: Record<string, IPayoutStatusAdapter>
  private readonly defaultAdapter: IPayoutStatusAdapter

  public constructor(
    @multiInject(TYPES.IPayoutStatusAdapter) @optional() adapters: IPayoutStatusAdapter[] = [],
  ) {
    this.adapters = {}
    for (const adapter of adapters) {
      const key = this.resolveAdapterKey(adapter)
      this.adapters[key] = adapter
    }
    this.defaultAdapter = {
      mapStatus: (rawStatus: string) => this.mapDefault(rawStatus),
    }
  }

  public getAdapter(provider: string): IPayoutStatusAdapter {
    const normalized = provider.toLowerCase()
    return this.adapters[normalized] ?? this.defaultAdapter
  }

  private mapDefault(rawStatus: string): TransactionStatus {
    const normalized = rawStatus.toLowerCase()
    if (['canceled', 'cancelled', 'error', 'failed', 'rejected'].some(word => normalized.includes(word))) {
      return TransactionStatus.PAYMENT_FAILED
    }
    if (['processed', 'settled', 'success', 'completed'].some(word => normalized.includes(word))) {
      return TransactionStatus.PAYMENT_COMPLETED
    }
    if (['pending', 'processing', 'queued'].some(word => normalized.includes(word))) {
      return TransactionStatus.PROCESSING_PAYMENT
    }
    return TransactionStatus.PROCESSING_PAYMENT
  }

  private resolveAdapterKey(adapter: IPayoutStatusAdapter): string {
    const name = (adapter as unknown as { name?: string }).name
    return typeof name === 'string' && name.length > 0 ? name.toLowerCase() : adapter.constructor.name.toLowerCase()
  }
}
