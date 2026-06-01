// useWalletFactory.ts
import { useCallback, useMemo } from 'react'

import type { IWallet } from '../interfaces/IWallet'
import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import type { IWalletFactory, WalletType } from '../interfaces/IWalletFactory'

import { useMiniPayWallet } from './wallets/useMiniPayWallet'
import { useSep24Wallet } from './wallets/useSep24Wallet'
import { useSolanaWallet } from './wallets/useSolanaWallet'
import { useStellarKitWallet } from './wallets/useStellarKitWallet'
import { useWalletConnectWallet } from './wallets/useWalletConnectWallet'

export function useWalletFactory({ walletAuth }: {
  walletAuth: IWalletAuthentication
},
): IWalletFactory {
  const miniPayWallet = useMiniPayWallet()
  const stellarKitWallet = useStellarKitWallet({ walletAuth })
  const walletConnectWallet = useWalletConnectWallet({ walletAuth })
  const sep24Wallet = useSep24Wallet({ walletAuthentication: walletAuth })
  const solanaWallet = useSolanaWallet(walletAuth)

  const getWalletHandler = useCallback(
    (walletType: WalletType): IWallet => {
      switch (walletType) {
        case 'mini-pay':
          return miniPayWallet.wallet
        case 'sep24':
          return sep24Wallet
        case 'solana':
          if (!solanaWallet.wallet) {
            throw new Error('Solana wallet hook returned no wallet — should be impossible when this case is selected')
          }
          return solanaWallet.wallet
        case 'stellar-kit':
          return stellarKitWallet
        case 'wallet-connect':
          return walletConnectWallet
        default:
          throw new Error(`Unknown wallet type: ${walletType as string}`)
      }
    },
    [
      miniPayWallet.wallet,
      sep24Wallet,
      solanaWallet.wallet,
      stellarKitWallet,
      walletConnectWallet,
    ],
  )

  return useMemo(() => ({
    getWalletHandler,
    miniPay: miniPayWallet.runtime,
  }), [getWalletHandler, miniPayWallet.runtime])
}
