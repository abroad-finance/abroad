import { IWallet } from './IWallet'

export interface IWalletFactory {
  getWalletHandler: (walletType: WalletType) => IWallet
}

export type WalletType = 'stellar-kit' | 'wallet-connect'
