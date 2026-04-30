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
import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'

import type { IWallet } from '../../interfaces/IWallet'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

import { WALLET_CONNECT_ID } from '../../shared/constants'
import { authTokenStore } from '../auth/authTokenStore'
import { sessionStore } from '../auth/sessionStore'
// Import shared utilities
import {
  getWCSession,
  saveWCSession,
  WC_METADATA,
} from './shared/wallet-connect-base'
import { caip10ToAddress } from './shared/wallet-utils'

// Build a mock WalletConnect module to bypass the bug in StellarWalletsKit's walletconnect.module.js
// Their module crashes if it encounters a WalletConnect session (e.g. Celo/Solana) that doesn't
// have the `stellar` namespace defined, because it blindly maps `session.namespaces.stellar.accounts`.
// Since we intercept WalletConnect in `isWalletConnect` and handle it manually, we only need this
// mock to display "Wallet Connect" in the StellarWalletsKit UI modal without crashing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockWalletConnectModule: any = {
  getAddress: async () => { throw new Error('Handled externally') },
  getNetwork: async () => { throw new Error('Handled externally') },
  isAvailable: async () => true,
  moduleType: ModuleType.BRIDGE_WALLET,
  productIcon: 'https://stellar.creit.tech/wallet-icons/walletconnect.png',
  productId: 'wallet_connect',
  productName: 'Wallet Connect',
  productUrl: 'https://walletconnect.com/',
  signAuthEntry: async () => { throw new Error('Handled externally') },
  signMessage: async () => { throw new Error('Handled externally') },
  signTransaction: async () => { throw new Error('Handled externally') },
}

const network = WalletNetwork.PUBLIC
const STELLAR_CHAIN_ID = import.meta.env.VITE_STELLAR_CHAIN_ID || 'stellar:pubnet'

const WALLETCONNECT_ACCOUNTS_ERROR
  = 'WalletConnect session is not ready yet. Please scan the QR code with your wallet app and approve the connection, then try again.'

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
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - payload.length % 4) % 4)
    const decoded = JSON.parse(atob(padded))
    return typeof decoded?.exp === 'number' && decoded.exp * 1000 > Date.now()
  }
  catch {
    return false
  }
}

const isWalletConnect = (id: string) => /walletconnect|wallet_connect|wallet-connect/i.test(id)

export function useStellarKitWallet(
  { onConnectError, walletAuth }: {
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

  // Internal walletId for StellarKit (uses original IDs like 'wallet_connect')
  const [internalWalletId, setInternalWalletId] = useState<null | string>(() => {
    if (!isStoredTokenValid()) return null
    const sessionWalletId = sessionStore.get()?.walletId ?? null
    // Convert normalized 'wallet-connect' back to 'wallet_connect' for StellarKit
    return sessionWalletId === 'wallet-connect' ? 'wallet_connect' : sessionWalletId
  })

  // Keep a ref in sync so ensureKit can read it without being a dep
  const walletIdRef = useRef(internalWalletId)
  useEffect(() => {
    walletIdRef.current = internalWalletId
  }, [internalWalletId])

  // Ensure WalletConnect client (for Stellar WalletConnect flow)
  const ensureWalletConnectClient = useCallback(async () => {
    if (!wcClientRef.current) {
      if (globalThis.window === undefined) {
        throw new TypeError('WalletConnect client is only available in the browser')
      }
      const client = await SignClient.init({
        metadata: WC_METADATA,
        projectId: WALLET_CONNECT_ID,
      })
      wcClientRef.current = client
    }
    return wcClientRef.current
  }, [])

  // Ensure WalletConnect modal
  const ensureWalletConnectModal = useCallback(() => {
    if (globalThis.window === undefined) {
      throw new TypeError('WalletConnect modal is only available in the browser')
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

  const applyWalletId = useCallback((id: null | string) => {
    const kit = ensureKit()
    if (id) {
      kit.setWallet(id)
    }
    setInternalWalletId(id)
  }, [ensureKit])

  // On mount, restore the WalletConnect topic if the session was persisted as a WC wallet
  useEffect(() => {
    if (!internalWalletId || !isWalletConnect(internalWalletId)) return
    const restoreWcTopic = async () => {
      try {
        const client = await ensureWalletConnectClient()
        const wcSession = getWCSession(STELLAR_CHAIN_ID)
        if (!wcSession?.topic) return
        const session = client.session.get(wcSession.topic)
        if (session) wcTopicRef.current = wcSession.topic
      }
      catch (err) {
        // Log WC topic restoration errors in dev mode
        if (import.meta.env.DEV) {
          console.error('Failed to restore WalletConnect topic', err)
        }
        // Don't clear session here - let the user try to reconnect
      }
    }
    void restoreWcTopic()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally runs only on mount

  // When the JWT is cleared externally (e.g. refresh failure), wipe the local session too
  useEffect(() => {
    const unsubscribe = authTokenStore.subscribe((token) => {
      if (!token) {
        sessionStore.clear()
        setAddress(null)
        setInternalWalletId(null)
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
          setInternalWalletId(null)
        }
      }
      catch (err) {
        // Can't verify — keep the session, but log in dev mode
        if (import.meta.env.DEV) {
          console.error('Failed to verify wallet address after visibility change', err)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [
    address,
    ensureKit,
    walletAuth,
  ])

  const signTransaction = useCallback(
    async ({ message }: { message: string }) => {
      const kit = ensureKit()
      if (!address) throw new Error('Wallet not connected')

      if (isWalletConnect(internalWalletId ?? '')) {
        const client = await ensureWalletConnectClient()
        if (!wcTopicRef.current) throw new Error('No WalletConnect session found')

        const stellarChainId = STELLAR_CHAIN_ID
        const result = await client.request({
          chainId: stellarChainId,
          request: {
            method: 'stellar_signXDR',
            params: { network: 'PUBLIC', xdr: message },
          },
          topic: wcTopicRef.current,
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
    [
      address,
      ensureKit,
      internalWalletId,
      ensureWalletConnectClient,
    ],
  )

  // Resolves the Stellar address for a WalletConnect session.
  // Restores an existing session from localStorage, or runs the full connect flow (QR modal).
  const resolveWcAddress = useCallback(async (): Promise<string> => {
    const client = await ensureWalletConnectClient()

    // Attempt to restore an existing session from localStorage
    const wcSession = getWCSession(STELLAR_CHAIN_ID)
    if (wcSession?.topic) {
      try {
        const session = client.session.get(wcSession.topic)
        if (session) wcTopicRef.current = wcSession.topic
      }
      catch { /* ignore invalid stored session */ }
    }

    // Start a new connection flow only when no valid session was restored
    if (!wcTopicRef.current) {
      const { approval, uri } = await client.connect({
        requiredNamespaces: {
          stellar: { chains: [STELLAR_CHAIN_ID], events: [], methods: ['stellar_signXDR'] },
        },
      })
      if (!uri) throw new Error('No WalletConnect URI')
      const modal = ensureWalletConnectModal()
      await modal.openModal({ chains: [STELLAR_CHAIN_ID], uri })
      try {
        const session = await approval()
        wcTopicRef.current = session.topic
        saveWCSession(STELLAR_CHAIN_ID, {
          address: '', // Will be populated after resolution
          chains: [STELLAR_CHAIN_ID],
          topic: session.topic,
        })
      }
      finally {
        await modal.closeModal()
      }
    }

    const session = client.session.get(wcTopicRef.current as string)
    const caip10 = session?.namespaces?.stellar?.accounts?.[0]
    const address = caip10 ? caip10ToAddress(caip10) : null
    if (!address) throw new Error('Failed to get wallet address from WalletConnect')
    return address
  }, [ensureWalletConnectClient, ensureWalletConnectModal])

  const connect = useCallback(async () => {
    const kit = ensureKit()

    kit.openModal({
      onWalletSelected: async (options: { id: string }) => {
        // Prevent multiple simultaneous auth flows (avoids "Request expired" from overwritten challenges)
        if (authenticatingRef.current) return
        authenticatingRef.current = true
        try {
          // Normalize wallet_connect to wallet-connect for consistency in session storage
          const normalizedWalletId = isWalletConnect(options.id) ? 'wallet-connect' : options.id
          // Apply the original ID to kit (it handles the conversion internally)
          applyWalletId(options.id)

          if (isWalletConnect(options.id)) {
            const address = await resolveWcAddress()
            setAddress(address)
            await walletAuth.authenticate({
              address,
              chainId: STELLAR_CHAIN_ID,
              signMessage: async (challenge: string) => {
                const client = await ensureWalletConnectClient()
                const result = await client.request({
                  chainId: STELLAR_CHAIN_ID,
                  request: { method: 'stellar_signXDR', params: { network: 'PUBLIC', xdr: challenge } },
                  topic: wcTopicRef.current as string,
                })
                return (result as { signedXDR: string }).signedXDR
              },
            })
            sessionStore.set({ address, chainId: STELLAR_CHAIN_ID, walletId: normalizedWalletId })
            return
          }

          const result = await kit.getAddress()
          const address = result?.address ?? null
          if (!address) throw new Error('Failed to get wallet address')
          setAddress(address)
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
          sessionStore.set({ address, chainId: STELLAR_CHAIN_ID, walletId: normalizedWalletId })
        }
        catch (err) {
          const message = getErrorMessage(err)
          if (import.meta.env.DEV) {
            console.error('Failed to connect wallet', err)
          }
          setAddress(null)
          walletAuth.setJwtToken(null)
          sessionStore.clear()
          if (onConnectError) {
            onConnectError(
              /accounts/i.test(message)
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
    onConnectError,
    resolveWcAddress,
    applyWalletId,
    walletAuth,
  ])

  const disconnect = useCallback(async () => {
    const kit = ensureKit()
    await kit.disconnect()

    // Clean up WalletConnect topic if exists
    if (wcTopicRef.current && wcClientRef.current) {
      try {
        await wcClientRef.current.disconnect({
          reason: { code: 6000, message: 'User disconnected' },
          topic: wcTopicRef.current,
        })
      }
      catch (err) {
        if (import.meta.env.DEV) {
          console.error('Failed to disconnect WalletConnect session', err)
        }
      }
      wcTopicRef.current = undefined
    }

    // Close WalletConnect modal if open
    if (wcModalRef.current) {
      try {
        await wcModalRef.current.closeModal()
      }
      catch {
        // Ignore modal close errors
      }
    }

    applyWalletId(null)
    setAddress(null)
    walletAuth.setJwtToken(null)
    sessionStore.clear()
  }, [
    ensureKit,
    applyWalletId,
    walletAuth,
  ])

  // Return an object compatible with IWallet
  return useMemo(() => ({
    address,
    chainId: STELLAR_CHAIN_ID,
    connect,
    disconnect,
    signTransaction,
    walletId: internalWalletId,
  }), [
    address,
    connect,
    disconnect,
    signTransaction,
    internalWalletId,
  ])
}

function buildModules() {
  // Allow native Stellar wallets on both mobile and desktop
  // Mobile users may have Stellar wallets installed (e.g., Lobstr, Albedo mobile apps)
  return [
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
