import { IWallet } from './IWallet'

export interface IWalletFactory {
  getWalletHandler: (walletType: WalletType) => IWallet
}

export type WalletType = 'sep24' | 'stellar-kit' | 'wallet-connect'
