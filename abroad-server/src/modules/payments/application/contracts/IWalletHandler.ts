import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

export interface IWalletHandler {
  readonly capability?: { blockchain: BlockchainNetwork }
  getAddressFromTransaction(
    transaction: { onChainId?: string }
  ): Promise<string>

  getTransactionFee?(transactionId: string): Promise<WalletTransactionFeeResult>

  send(params: WalletSendParams): Promise<WalletSendResult>
}

export type WalletSendParams = {
  address: string
  amount: number
  cryptoCurrency: CryptoCurrency
  memo?: string
}

export type WalletSendResult
  = | { code?: WalletFailureCode, reason?: string, success: false, transactionId?: string }
    | { networkFee?: WalletNetworkFee, success: true, transactionId?: string }

export type WalletTransactionFeeResult
  = | { fee: WalletNetworkFee, outcome: 'found' }
    | { outcome: 'pending', reason: string }
    | { outcome: 'unavailable', reason: string }

type WalletFailureCode = 'permanent' | 'retriable' | 'validation'

type WalletNetworkFee = {
  amount: string
  currency: string
}
