import { inject, named } from 'inversify'

import type { IWallet } from '../interfaces/IWallet'

import { ITypes } from '../interfaces/ITypes'
import { IWalletFactory, WalletType } from '../interfaces/IWalletFactory'

export class WalletFactory implements IWalletFactory {
  constructor(
    @inject(ITypes.IWallet) @named('stellar-kit') private stellarKit: IWallet,
    @inject(ITypes.IWallet) @named('wallet-connect') private walletConnect: IWallet,
  ) {}

  getWalletHandler: (walletType: WalletType) => IWallet = (walletType) => {
    switch (walletType) {
      case 'stellar-kit':
        return this.stellarKit
      case 'wallet-connect':
        return this.walletConnect
      default:
        throw new Error(`Unknown wallet type: ${walletType}`)
    }
  }
}
