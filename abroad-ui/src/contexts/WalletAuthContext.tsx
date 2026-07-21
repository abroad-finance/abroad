import { createContext } from 'react'

import { IWallet } from '../interfaces/IWallet'
import { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import { IWalletFactory, MiniPayRuntime } from '../interfaces/IWalletFactory'

interface WalletAuthState {
  defaultWallet?: IWallet
  getWalletHandler?: IWalletFactory['getWalletHandler']
  miniPay: MiniPayRuntime
  setActiveWallet?: (wallet: IWallet) => void
  wallet?: IWallet
  walletAuthentication?: IWalletAuthentication
}

export const WalletAuthContext = createContext<WalletAuthState>({
  miniPay: {
    isActive: false,
    isReady: false,
    isResolving: false,
    status: 'inactive',
  },
})
