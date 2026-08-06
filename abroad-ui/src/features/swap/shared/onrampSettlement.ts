import type { TransactionStatus } from '../../../api'

export type OnrampSettlementStage
  = | 'awaiting-payment'
    | 'delivered'
    | 'delivering'
    | 'expired'
    | 'failed'
    | 'unknown'
    | 'wrong-amount'

export type OnrampTransactionStatus = {
  onChainTxHash: null | string
  stage: OnrampSettlementStage
  status: null | TransactionStatus
}

/**
 * The onramp has only one question the customer really cares about — has my
 * money arrived, and are my coins on the way — so the six backend states
 * collapse to four moments plus two dead ends.
 */
export const toSettlementStage = (status: null | TransactionStatus): OnrampSettlementStage => {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return 'awaiting-payment'
    // Nothing read yet: the first reconcile has not landed.
    case null:
      return 'unknown'
    case 'PAYMENT_COMPLETED':
      return 'delivered'
    case 'PAYMENT_EXPIRED':
      return 'expired'
    case 'PAYMENT_FAILED':
      return 'failed'
    // The PIX landed and the crypto send is running. This is the whole reason
    // the screen needs to be live: it is the only window in which the customer
    // has paid and holds nothing.
    case 'PROCESSING_PAYMENT':
      return 'delivering'
    case 'WRONG_AMOUNT':
      return 'wrong-amount'
    default:
      return 'unknown'
  }
}
