import { createContext } from 'react'

import { IWallet } from '../interfaces/IWallet'

interface WalletAuthState {
  authenticateWithWallet: () => Promise<void>
  kit?: IWallet
  kycUrl: null | string
  setKycUrl: (url: string) => void
  token: null | string
}

export const WalletAuthContext = createContext<WalletAuthState>({
  authenticateWithWallet: async () => { },
  kycUrl: null,
  setKycUrl: () => { },
  token: null,
})
