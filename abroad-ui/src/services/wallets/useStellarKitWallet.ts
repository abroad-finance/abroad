import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
import {
  AlbedoModule,
  FreighterModule,
  HanaModule,
  HotWalletModule,
  LobstrModule,
  ModuleType,
  StellarWalletsKit,
  WalletNetwork,
  xBullModule,
} from '@creit.tech/stellar-wallets-kit'
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module'
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'

import type { IWallet } from '../../interfaces/IWallet'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

import { WALLET_CONNECT_ID } from '../../shared/constants'
import { authTokenStore } from '../auth/authTokenStore'
import { sessionStore } from '../auth/sessionStore'

// Build a mock WalletConnect module to bypass the bug in StellarWalletsKit's walletconnect.module.js
// Their module crashes if it encounters a WalletConnect session (e.g. Celo/Solana) that doesn't
// have the `stellar` namespace defined, because it blindly maps `session.namespaces.stellar.accounts`.
// Since we intercept WalletConnect in `isWalletConnect` and handle it manually, we only need this
// mock to display "Wallet Connect" in the StellarWalletsKit UI modal without crashing.
const mockWalletConnectModule: any = {
  moduleType: ModuleType.BRIDGE_WALLET,
  productId: 'wallet_connect', // WALLET_CONNECT_ID is 'wallet_connect'
  productName: 'Wallet Connect',
  productUrl: 'https://walletconnect.com/',
  productIcon: 'https://stellar.creit.tech/wallet-icons/walletconnect.png',
  isAvailable: async () => true,
  getAddress: async () => { throw new Error('Handled externally') },
  signTransaction: async () => { throw new Error('Handled externally') },
  signAuthEntry: async () => { throw new Error('Handled externally') },
  signMessage: async () => { throw new Error('Handled externally') },
  getNetwork: async () => { throw new Error('Handled externally') },
}

// Keep the WalletConnect metadata constants to pass them into our manual signClient instantiation
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

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    if (typeof m === 'string') return m
  }
  return String(err)
}

/** Returns true if the stored JWT token exists and has not expired. */
const isStoredTokenValid = (): boolean => {
  const token = authTokenStore.getToken()
  if (!token) return false
  try {
    const [, payload] = token.split('.')
    if (!payload) return false
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof decoded?.exp === 'number' && decoded.exp * 1000 > Date.now()
  }
  catch {
    return false
  }
}

const isWalletConnect = (id: string) => /walletconnect|wallet_connect/i.test(id)

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
  const authenticatingRef = useRef(false)

  // Restore address and walletId from session on page load if the JWT is still valid
  const [address, setAddress] = useState<null | string>(() => {
    if (!isStoredTokenValid()) return null
    return sessionStore.get()?.address ?? null
  })

  const [walletId, _setWalletId] = useState<null | string>(() => {
    if (!isStoredTokenValid()) return null
    return sessionStore.get()?.walletId ?? null
  })

  // Keep a ref in sync so ensureKit can read it without being a dep
  const walletIdRef = useRef(walletId)
  useEffect(() => { walletIdRef.current = walletId }, [walletId])

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
      // Restore the previously selected wallet module into the newly-created kit
      if (walletIdRef.current) {
        kitRef.current.setWallet(walletIdRef.current)
      }
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

  // On mount, restore the WalletConnect topic if the session was persisted as a WC wallet
  useEffect(() => {
    if (!walletId || !isWalletConnect(walletId)) return
    const restoreWcTopic = async () => {
      try {
        const client = await ensureWalletConnectClient()
        const storeKey = `wc:session:${STELLAR_CHAIN_ID}`
        const stored = localStorage.getItem(storeKey)
        if (!stored) return
        const { topic } = JSON.parse(stored)
        const session = client.session.get(topic)
        if (session) wcTopicRef.current = topic
      }
      catch { /* ignore */ }
    }
    void restoreWcTopic()
  }, []) // intentionally runs only on mount

  // When the JWT is cleared externally (e.g. refresh failure), wipe the local session too
  useEffect(() => {
    const unsubscribe = authTokenStore.subscribe((token) => {
      if (!token) {
        sessionStore.clear()
        setAddress(null)
        _setWalletId(null)
      }
    })
    return unsubscribe
  }, [])

  // Detect account changes in the wallet extension while the tab is in the background
  useEffect(() => {
    if (!address) return
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return
      const session = sessionStore.get()
      if (!session || !address) return
      // Only check non-WalletConnect wallets (Freighter, etc.) — WC sessions are self-contained
      if (isWalletConnect(session.walletId)) return
      try {
        const kit = ensureKit()
        const result = await kit.getAddress()
        const current = result?.address ?? null
        if (current && current !== session.address) {
          // User switched accounts in the wallet extension without logging out
          sessionStore.clear()
          walletAuth.setJwtToken(null)
          setAddress(null)
          _setWalletId(null)
        }
      }
      catch { /* Can't verify — keep the session */ }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [address, ensureKit, walletAuth])

  const signTransaction = useCallback(
    async ({ message }: { message: string }) => {
      const kit = ensureKit()
      if (!address) throw new Error('Wallet not connected')

      if (walletId === mockWalletConnectModule.productId) {
        const client = await ensureWalletConnectClient()
        if (!wcTopicRef.current) throw new Error('No WalletConnect session found')

        const stellarChainId = STELLAR_CHAIN_ID
        const result = await client.request({
          chainId: stellarChainId,
          topic: wcTopicRef.current,
          request: {
            method: 'stellar_signXDR',
            params: { network: 'PUBLIC', xdr: message },
          },
        })

        return {
          signedTxXdr: (result as { signedXDR: string }).signedXDR,
          signerAddress: address as string | undefined,
        }
      }

      const { signedTxXdr } = await kit.signTransaction(message, {
        address,
        networkPassphrase: network,
      })
      return {
        signedTxXdr,
        signerAddress: address as string | undefined,
      }
    },
    [address, ensureKit, walletId, ensureWalletConnectClient],
  )

  const connect = useCallback(async () => {
    const kit = ensureKit()

    kit.openModal({
      onWalletSelected: async (options: { id: string }) => {
        // Prevent multiple simultaneous auth flows (avoids "Request expired" from overwritten challenges)
        if (authenticatingRef.current) return
        authenticatingRef.current = true
        try {
          setWalletId(options.id)

          let address: string | null = null

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
            sessionStore.set({ address, chainId: STELLAR_CHAIN_ID, walletId: options.id })
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
          sessionStore.set({ address, chainId: STELLAR_CHAIN_ID, walletId: options.id })
        }
        catch (err) {
          const message = getErrorMessage(err)
          console.error('Failed to connect wallet', err)
          setAddress(null)
          walletAuth.setJwtToken(null)
          sessionStore.clear()
          if (onConnectError) {
            const isWalletConnectAccounts = /accounts/i.test(message)
            onConnectError(
              isWalletConnectAccounts
                ? WALLETCONNECT_ACCOUNTS_ERROR
                : message || 'Failed to connect wallet. Please try again.',
            )
          }
        }
        finally {
          authenticatingRef.current = false
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
    sessionStore.clear()
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
    ? [mockWalletConnectModule]
    : [
        new FreighterModule(),
        new LobstrModule(),
        new AlbedoModule(),
        new LedgerModule(),
        mockWalletConnectModule,
        new HotWalletModule(),
        new xBullModule(),
        new HanaModule(),
      ]
}

function isMobileUA(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
