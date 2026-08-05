import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

export interface IWalletHandler {
  readonly capability?: { blockchain: BlockchainNetwork }
  getAddressFromTransaction(
    transaction: { onChainId?: string }
  ): Promise<string>

  getTransactionFee?(transactionId: string): Promise<WalletTransactionFeeResult>

  reconcileTransaction?(transactionId: string): Promise<WalletTransactionReconciliationResult>

  send(params: WalletSendParams): Promise<WalletSendResult>

  sendDurably?(
    params: WalletSendParams,
    persistPrepared: (prepared: WalletPreparedSend) => Promise<void>,
  ): Promise<WalletDurableSendResult>
}

export type WalletDurableSendResult
  = | { outcome: 'ambiguous', reason: string, transactionId: string }
    | { outcome: 'confirmed', transactionId: string }

export type WalletPreparedSend = {
  amount: string
  expiresAt: Date
  signedEnvelopeXdr: string
  transactionId: string
}

export type WalletSendParams = {
  address: string
  amount: number
  /**
   * 1-based delivery attempt. Chains that bid for inclusion use it to escalate
   * the bid, so a send that timed out because it was outbid competes harder
   * next time instead of re-offering the number that just lost.
   */
  attempt?: number
  cryptoCurrency: CryptoCurrency
  memo?: string
}

export type WalletSendResult
  = | {
    code?: WalletFailureCode
    reason?: string
    reconciliationRequired: true
    success: false
    transactionId: string
  }
  | {
    code?: WalletFailureCode
    reason?: string
    reconciliationRequired?: false
    success: false
    transactionId?: string
  }
  | { networkFee?: WalletNetworkFee, success: true, transactionId?: string }

export type WalletTransactionFeeResult
  = | { fee: WalletNetworkFee, outcome: 'found' }
    | { outcome: 'pending', reason: string }
    | { outcome: 'unavailable', reason: string }

export type WalletTransactionReconciliationResult
  = | { outcome: 'absent' }
    | { outcome: 'confirmed', transactionId: string }
    | { outcome: 'failed', transactionId: string }
    | { outcome: 'unavailable', reason: string }

type WalletFailureCode = 'permanent' | 'retriable' | 'validation'

type WalletNetworkFee = {
  amount: string
  currency: string
}
