import { IWallet } from './IWallet'

export interface IWalletFactory {
  getWalletHandler: (walletType: WalletType) => IWallet
  miniPay: MiniPayRuntime
}

export type MiniPayRuntime
  = | {
    isActive: false
    isReady: false
    isResolving: false
    status: 'inactive'
  }
  | {
    isActive: true
    isReady: false
    isResolving: false
    status: 'available'
  }
  | {
    isActive: true
    isReady: false
    isResolving: true
    status: 'resolving'
  }
  | {
    isActive: true
    isReady: true
    isResolving: false
    status: 'ready'
  }

export type WalletType = 'mini-pay' | 'sep24' | 'stellar-kit' | 'wallet-connect'
