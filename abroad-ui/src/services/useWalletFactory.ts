// useWalletFactory.ts
import { useCallback } from 'react'

import type { IWallet } from '../interfaces/IWallet'
import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import type { IWalletFactory, WalletType } from '../interfaces/IWalletFactory'

import { useStellarKitWallet } from './wallets/useStellarKitWallet'
import { useWalletConnectWallet } from './wallets/useWalletConnectWallet'

export function useWalletFactory({ walletAuth }: {
  walletAuth: IWalletAuthentication
},
): IWalletFactory {
  const stellarKitWallet = useStellarKitWallet({ walletAuth })
  const walletConnectWallet = useWalletConnectWallet({ walletAuth })

  const getWalletHandler = useCallback(
    (walletType: WalletType): IWallet => {
      switch (walletType) {
        case 'stellar-kit':
          return stellarKitWallet
        case 'wallet-connect':
          return walletConnectWallet
        default:
          throw new Error(`Unknown wallet type: ${walletType as string}`)
      }
    },
    [stellarKitWallet, walletConnectWallet],
  )

  return { getWalletHandler }
}
