import { IWallet } from './IWallet'

export interface IWalletFactory {
  getWalletHandler: (walletType: WalletType) => IWallet
  miniPay: MiniPayRuntime
}

export interface MiniPayRuntime {
  isActive: boolean
  isReady: boolean
  isResolving: boolean
}

export type WalletType = 'mini-pay' | 'sep24' | 'stellar-kit' | 'wallet-connect'
