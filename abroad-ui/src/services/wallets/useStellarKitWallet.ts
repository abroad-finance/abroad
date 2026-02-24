import {
  AlbedoModule,
  FreighterModule,
  HanaModule,
  HotWalletModule,
  LobstrModule,
  StellarWalletsKit,
  WalletNetwork,
  xBullModule,
} from '@creit.tech/stellar-wallets-kit'
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module'
import {
  WalletConnectAllowedMethods,
  WalletConnectModule,
} from '@creit.tech/stellar-wallets-kit/modules/walletconnect.module'
// useStellarKitWallet.ts
import {
  useCallback, useMemo, useRef, useState,
} from 'react'

import type { IWallet } from '../../interfaces/IWallet'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

import { WALLET_CONNECT_ID } from '../../shared/constants'

// Build the WalletConnect module once (no browser globals required here)
const walletConnectModule = new WalletConnectModule({
  description:
    'Abroad bridges USDC on Stellar with real-time payment networks around the world, enabling seamless crypto-fiat payments. You will be able to pay anywhere in Brazil and Colombia with your USDC.',
  icons: ['https://storage.googleapis.com/cdn-abroad/Icons/Favicon/Abroad_Badge_transparent.png'],
  method: WalletConnectAllowedMethods.SIGN,
  name: 'Abroad',
  network: WalletNetwork.PUBLIC,
  projectId: WALLET_CONNECT_ID,
  url: 'https://app.abroad.finance',
})

const network = WalletNetwork.PUBLIC
const STELLAR_CHAIN_ID = import.meta.env.VITE_STELLAR_CHAIN_ID || 'stellar:pubnet'

export function useStellarKitWallet(
  { walletAuth }: { walletAuth: IWalletAuthentication },
): IWallet {
  const kitRef = useRef<null | StellarWalletsKit>(null)

  const [address, setAddress] = useState<null | string>(null)
  const [walletId, _setWalletId] = useState<null | string>(null)

  const ensureKit = useCallback((): StellarWalletsKit => {
    if (!kitRef.current) {
      kitRef.current = new StellarWalletsKit({
        modules: buildModules(),
        network,
      })
    }
    return kitRef.current
  }, [])

  const setWalletId = useCallback((id: null | string) => {
    const kit = ensureKit()
    if (id) {
      kit.setWallet(id)
    }
    _setWalletId(id)
  }, [ensureKit])

  const signTransaction = useCallback(
    async ({ message }: { message: string }) => {
      const kit = ensureKit()
      if (!address) throw new Error('Wallet not connected')
      const { signedTxXdr } = await kit.signTransaction(message, {
        address,
        networkPassphrase: network,
      })
      return {
        signedTxXdr,
        signerAddress: address as string | undefined,
      }
    },
    [address, ensureKit],
  )

  const connect = useCallback(async () => {
    const kit = ensureKit()

    kit.openModal({
      onWalletSelected: async (options: { id: string }) => {
        try {
          setWalletId(options.id)

          const { address } = await kit.getAddress()
          setAddress(address)
          if (!address) throw new Error('Failed to get wallet address')
          await walletAuth.authenticate({
            address,
            chainId: STELLAR_CHAIN_ID,
            signMessage: async (challenge: string) => {
              const { signedTxXdr } = await kit.signTransaction(challenge, {
                address,
                networkPassphrase: network,
              })
              return signedTxXdr
            },
          })
        }
        catch (err) {
          console.error('Failed to connect wallet', err)
          setAddress(null)
          walletAuth.setJwtToken(null)
        }
      },
    })
  }, [
    ensureKit,
    setWalletId,
    walletAuth,
  ])

  const disconnect = useCallback(async () => {
    const kit = ensureKit()
    await kit.disconnect()
    setWalletId(null)
    setAddress(null)
    walletAuth.setJwtToken(null)
  }, [
    ensureKit,
    setWalletId,
    walletAuth,
  ])

  // Return an object compatible with IWallet
  return useMemo(() => ({
    address,
    chainId: STELLAR_CHAIN_ID,
    connect,
    disconnect,
    signTransaction,
    walletId,
  }), [
    address,
    connect,
    disconnect,
    signTransaction,
    walletId,
  ])
}

function buildModules() {
  return isMobileUA()
    ? [walletConnectModule]
    : [
        new FreighterModule(),
        new LobstrModule(),
        new AlbedoModule(),
        new LedgerModule(),
        walletConnectModule,
        new HotWalletModule(),
        new xBullModule(),
        new HanaModule(),
      ]
}

function isMobileUA(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
