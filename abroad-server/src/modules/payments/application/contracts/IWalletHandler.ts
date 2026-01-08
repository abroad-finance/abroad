import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

export interface IWalletHandler {
  readonly capability: { blockchain: BlockchainNetwork }
  getAddressFromTransaction(
    transaction: { onChainId?: string }
  ): Promise<string>

  send(params: WalletSendParams): Promise<WalletSendResult>
}

export type WalletFailureCode = 'validation' | 'retriable' | 'permanent'

export type WalletSendParams = {
  address: string
  amount: number
  cryptoCurrency: CryptoCurrency
  memo?: string
}

export type WalletSendResult =
  | { success: true, transactionId?: string }
  | { code?: WalletFailureCode, reason?: string, success: false, transactionId?: string }
