import { createContext } from 'react'

import { IWallet } from '../interfaces/IWallet'
import { IWalletAuthentication } from '../interfaces/IWalletAuthentication'

interface WalletAuthState {
  kit?: IWallet
  kycUrl: null | string
  setKycUrl: (url: string) => void
  walletAuthentication?: IWalletAuthentication
}

export const WalletAuthContext = createContext<WalletAuthState>({
  kycUrl: null,
  setKycUrl: () => { },
})
