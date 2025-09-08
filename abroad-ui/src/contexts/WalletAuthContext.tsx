import { createContext } from 'react'

interface WalletAuthState {
  address: null | string
  authenticateWithWallet: () => Promise<void>
  kycUrl: null | string
  logout: () => void
  setKycUrl: (url: string) => void
  token: null | string
  walletId: null | string
}

export const WalletAuthContext = createContext<WalletAuthState>({
  address: null,
  authenticateWithWallet: async () => { },
  kycUrl: null,
  logout: () => { },
  setKycUrl: () => {}, token: null,
  walletId: null,
})
