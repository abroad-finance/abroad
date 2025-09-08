// useWalletFactory.ts
import { useCallback } from 'react'

import type { IWallet } from '../interfaces/IWallet'
import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import type { IWalletFactory, WalletType } from '../interfaces/IWalletFactory'

import { useSep24Wallet } from './wallets/useSep24Wallet'
import { useStellarKitWallet } from './wallets/useStellarKitWallet'
import { useWalletConnectWallet } from './wallets/useWalletConnectWallet'

export function useWalletFactory({ walletAuth }: {
  walletAuth: IWalletAuthentication
},
): IWalletFactory {
  const stellarKitWallet = useStellarKitWallet({ walletAuth })
  const walletConnectWallet = useWalletConnectWallet({ walletAuth })
  const sep24Wallet = useSep24Wallet({ walletAuthentication: walletAuth })

  const getWalletHandler = useCallback(
    (walletType: WalletType): IWallet => {
      switch (walletType) {
        case 'sep24':
          return sep24Wallet
        case 'stellar-kit':
          return stellarKitWallet
        case 'wallet-connect':
          return walletConnectWallet
        default:
          throw new Error(`Unknown wallet type: ${walletType as string}`)
      }
    },
    [
      sep24Wallet,
      stellarKitWallet,
      walletConnectWallet,
    ],
  )

  return { getWalletHandler }
}
