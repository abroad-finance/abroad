import { createContext } from 'react'

import { IWallet } from '../interfaces/IWallet'
import { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import { IWalletFactory } from '../interfaces/IWalletFactory'

interface WalletAuthState {
  defaultWallet?: IWallet
  getWalletHandler?: IWalletFactory['getWalletHandler']
  kycUrl: null | string
  setActiveWallet?: (wallet: IWallet) => void
  setKycUrl: (url: null | string) => void
  wallet?: IWallet
  walletAuthentication?: IWalletAuthentication
}

export const WalletAuthContext = createContext<WalletAuthState>({
  kycUrl: null,
  setKycUrl: () => { },
})
