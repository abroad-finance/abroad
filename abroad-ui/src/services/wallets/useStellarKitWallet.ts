import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
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

// WalletConnect metadata for Stellar
const wcMetadata = {
  description:
    'Abroad bridges USDC on Stellar with real-time payment networks around the world, enabling seamless crypto-fiat payments. You will be able to pay anywhere in Brazil and Colombia with your USDC.',
  icons: ['https://storage.googleapis.com/cdn-abroad/Icons/Favicon/Abroad_Badge_transparent.png'],
  name: 'Abroad',
  url: 'https://app.abroad.finance',
}

const caip10ToAddress = (caip10: string) => {
  const parts = caip10.split(':')
  return parts[2] ?? ''
}

const network = WalletNetwork.PUBLIC
const STELLAR_CHAIN_ID = import.meta.env.VITE_STELLAR_CHAIN_ID || 'stellar:pubnet'

const WALLETCONNECT_ACCOUNTS_ERROR =
  'WalletConnect session is not ready yet. Please scan the QR code with your wallet app and approve the connection, then try again.'

/** Max time to wait for WalletConnect session to be ready (user scans QR and approves) */
const WALLETCONNECT_WAIT_MS = 120_000
const WALLETCONNECT_POLL_INTERVAL_MS = 1_500

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    if (typeof m === 'string') return m
  }
  return String(err)
}

export function useStellarKitWallet(
  {
    onConnectError,
    walletAuth,
  }: {
    onConnectError?: (message: string) => void
    walletAuth: IWalletAuthentication
  },
): IWallet {
  const kitRef = useRef<null | StellarWalletsKit>(null)
  const wcClientRef = useRef<null | SignClient>(null)
  const wcModalRef = useRef<null | WalletConnectModal>(null)
  const wcTopicRef = useRef<string | undefined>(undefined)

  const [address, setAddress] = useState<null | string>(null)
  const [walletId, _setWalletId] = useState<null | string>(null)

  // Ensure WalletConnect client (for Stellar WalletConnect flow)
  const ensureWalletConnectClient = useCallback(async () => {
    if (!wcClientRef.current) {
      if (typeof window === 'undefined') {
        throw new Error('WalletConnect client is only available in the browser')
      }
      const client = await SignClient.init({
        metadata: wcMetadata,
        projectId: WALLET_CONNECT_ID,
      })
      wcClientRef.current = client
    }
    return wcClientRef.current
  }, [])

  // Ensure WalletConnect modal
  const ensureWalletConnectModal = useCallback(() => {
    if (typeof window === 'undefined') {
      throw new Error('WalletConnect modal is only available in the browser')
    }
    if (!wcModalRef.current) {
      wcModalRef.current = new WalletConnectModal({ projectId: WALLET_CONNECT_ID })
    }
    return wcModalRef.current
  }, [])

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

          let address: string | null = null
          const isWalletConnect = (id: string) =>
            /walletconnect|wallet_connect/i.test(id)

          if (isWalletConnect(options.id)) {
            // For WalletConnect in Stellar Kit, the kit.getAddress() doesn't work because
            // the session isn't established when onWalletSelected fires. We use the full
            // WalletConnect flow (like useWalletConnectWallet) to connect properly.
            const client = await ensureWalletConnectClient()
            const stellarChainId = STELLAR_CHAIN_ID

            // Try to restore existing session
            const storeKey = `wc:session:${stellarChainId}`
            let restored = false
            if (typeof window !== 'undefined') {
              const stored = localStorage.getItem(storeKey)
              if (stored) {
                try {
                  const { topic } = JSON.parse(stored)
                  const session = client.session.get(topic)
                  if (session) {
                    wcTopicRef.current = topic
                    restored = true
                  }
                }
                catch {
                  // Invalid stored session
                }
              }
            }

            if (!restored) {
              // Start new connection flow
              const { approval, uri } = await client.connect({
                requiredNamespaces: {
                  stellar: {
                    chains: [stellarChainId],
                    events: [],
                    methods: ['stellar_signXDR'],
                  },
                },
              })

              if (!uri) throw new Error('No WalletConnect URI')

              const modal = ensureWalletConnectModal()
              await modal.openModal({ chains: [stellarChainId], uri })

              const session = await approval()
              wcTopicRef.current = session.topic
              await modal.closeModal()

              // Store session for future use
              if (typeof window !== 'undefined') {
                localStorage.setItem(storeKey, JSON.stringify({ topic: session.topic }))
              }
            }

            // Get address from session
            const session = client.session.get(wcTopicRef.current as string)
            const ns = session?.namespaces?.stellar
            const caip10 = ns?.accounts?.[0]
            address = caip10 ? caip10ToAddress(caip10) : null

            if (!address) throw new Error('Failed to get wallet address from WalletConnect')

            setAddress(address)
            await walletAuth.authenticate({
              address,
              chainId: STELLAR_CHAIN_ID,
              signMessage: async (challenge: string) => {
                // For Stellar via WalletConnect, we need to use the signClient directly
                const result = await client.request({
                  chainId: stellarChainId,
                  topic: wcTopicRef.current as string,
                  request: {
                    method: 'stellar_signXDR',
                    params: { network: 'PUBLIC', xdr: challenge },
                  },
                })
                return (result as { signedXDR: string }).signedXDR
              },
            })
            return
          }

          const result = await kit.getAddress()
          address = result?.address ?? null
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
          const message = getErrorMessage(err)
          console.error('Failed to connect wallet', err)
          setAddress(null)
          walletAuth.setJwtToken(null)
          if (onConnectError) {
            const isWalletConnectAccounts = /accounts/i.test(message)
            onConnectError(
              isWalletConnectAccounts
                ? WALLETCONNECT_ACCOUNTS_ERROR
                : message || 'Failed to connect wallet. Please try again.',
            )
          }
        }
      },
    })
  }, [
    ensureKit,
    ensureWalletConnectClient,
    ensureWalletConnectModal,
    onConnectError,
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
