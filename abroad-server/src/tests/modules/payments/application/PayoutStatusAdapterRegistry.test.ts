import { TransactionStatus } from '@prisma/client'

import { IPayoutStatusAdapter } from '../../../../modules/payments/application/contracts/IPayoutStatusAdapter'
import { PayoutStatusAdapterRegistry } from '../../../../modules/payments/application/PayoutStatusAdapterRegistry'

class CustomAdapter implements IPayoutStatusAdapter {
  public mapStatus(): TransactionStatus {
    return TransactionStatus.PAYMENT_COMPLETED
  }
}

class TransferoAdapter implements IPayoutStatusAdapter {
  public readonly name = 'transfero'
  public mapStatus(): TransactionStatus {
    return TransactionStatus.PAYMENT_FAILED
  }
}

describe('PayoutStatusAdapterRegistry', () => {
  it('returns adapters by normalized provider key', () => {
    const customAdapter = new CustomAdapter()
    const registry = new PayoutStatusAdapterRegistry([new TransferoAdapter(), customAdapter])

    expect(registry.getAdapter('TRANSFERO')).toBeInstanceOf(TransferoAdapter)
    expect(registry.getAdapter('customadapter')).toBe(customAdapter)
  })

  it('maps provider statuses using the default adapter heuristics', () => {
    const registry = new PayoutStatusAdapterRegistry()
    const adapter = registry.getAdapter('unknown-provider')

    expect(adapter.mapStatus('Payment cancelled by user')).toBe(TransactionStatus.PAYMENT_FAILED)
    expect(adapter.mapStatus('Payment completed successfully')).toBe(TransactionStatus.PAYMENT_COMPLETED)
    expect(adapter.mapStatus('queued for processing')).toBe(TransactionStatus.PROCESSING_PAYMENT)
    expect(adapter.mapStatus('unrecognized status')).toBe(TransactionStatus.PROCESSING_PAYMENT)
  })
})
