import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

export interface IWalletHandler {
  readonly capability?: { blockchain: BlockchainNetwork }
  getAddressFromTransaction(
    transaction: { onChainId?: string }
  ): Promise<string>

  send(params: WalletSendParams): Promise<WalletSendResult>
}

export type WalletFailureCode = 'permanent' | 'retriable' | 'validation'

export type WalletSendParams = {
  address: string
  amount: number
  cryptoCurrency: CryptoCurrency
  memo?: string
}

export type WalletSendResult
  = | { code?: WalletFailureCode, reason?: string, success: false, transactionId?: string }
    | { success: true, transactionId?: string }
