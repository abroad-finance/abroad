import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
import { getSdkError } from '@walletconnect/utils'
// useWalletConnectWallet.ts
import { useCallback, useRef, useState } from 'react'

import type { IWallet } from '../../interfaces/IWallet'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

import { WALLET_CONNECT_ID } from '../../shared/constants'

const STELLAR_CHAIN = 'stellar:pubnet'
const WC_METHOD_SIGN = 'stellar_signXDR'
const SESSION_STORE_KEY = 'wc:stellar:session'

type WCMetadata = {
  description: string
  icons: string[]
  name: string
  url: string
}

const metadata: WCMetadata = {
  description:
    'Abroad bridges USDC on Stellar with real-time payment networks around the world, enabling seamless crypto-fiat payments. You will be able to pay anywhere in Brazil and Colombia with your USDC.',
  icons: ['https://storage.googleapis.com/cdn-abroad/Icons/Favicon/Abroad_Badge_transparent.png'],
  name: 'Abroad',
  url: 'https://app.abroad.finance',
}

/**
 * React hook that provides an IWallet-like interface using WalletConnect v2.
 *
 * Usage:
 *   const wallet = useWalletConnectWallet(walletAuth)
 *   const { authToken } = await wallet.connect()
 */
export function useWalletConnectWallet({ walletAuth }: {
  walletAuth: IWalletAuthentication
},
): IWallet {
  const clientRef = useRef<null | SignClient>(null)
  const topicRef = useRef<string | undefined>(undefined)
  const modalRef = useRef<null | WalletConnectModal>(null)

  const [address, setAddress] = useState<null | string>(null)

  const ensureModal = useCallback(() => {
    if (typeof window === 'undefined') {
      throw new Error('WalletConnect modal is only available in the browser')
    }
    if (!modalRef.current) {
      modalRef.current = new WalletConnectModal({ projectId: WALLET_CONNECT_ID })
    }
    return modalRef.current
  }, [])

  const caip10ToAddress = (caip10: string) => {
    // "stellar:pubnet:GABC...XYZ" -> third segment is address
    const parts = caip10.split(':')
    return parts[2] ?? ''
  }

  const ensureClient = useCallback(async () => {
    if (!clientRef.current) {
      if (typeof window === 'undefined') {
        throw new Error('WalletConnect client is only available in the browser')
      }
      const client = await SignClient.init({
        metadata,
        projectId: WALLET_CONNECT_ID,
      })
      clientRef.current = client

      // Try to restore persisted session
      const raw = localStorage.getItem(SESSION_STORE_KEY)
      if (raw) {
        try {
          const { topic } = JSON.parse(raw) as { topic?: string }
          if (topic && client.session.get(topic)) {
            topicRef.current = topic
          }
          else {
            localStorage.removeItem(SESSION_STORE_KEY)
          }
        }
        catch {
          localStorage.removeItem(SESSION_STORE_KEY)
        }
      }

      // Clean up persisted topic if the wallet deletes the session
      client.on('session_delete', () => {
        topicRef.current = undefined
        localStorage.removeItem(SESSION_STORE_KEY)
      })
    }
    return clientRef.current
  }, [])

  const getAddress = useCallback(async () => {
    if (!clientRef.current) throw new Error('WalletConnect client not initialized')
    if (!topicRef.current) throw new Error('No active WalletConnect session')
    const ns = clientRef.current.session.get(topicRef.current)?.namespaces?.stellar
    const caip10 = ns?.accounts?.[0]
    if (!caip10) throw new Error('No Stellar account in session')
    return { address: caip10ToAddress(caip10) }
  }, [])

  const signTransaction: IWallet['signTransaction'] = useCallback(async ({ message }) => {
    if (!clientRef.current) throw new Error('WalletConnect client not initialized')
    if (!topicRef.current) throw new Error('No active WalletConnect session')

    const result = await clientRef.current.request<{ signedXDR: string }>({
      chainId: STELLAR_CHAIN,
      request: {
        method: WC_METHOD_SIGN,
        params: { xdr: message },
      },
      topic: topicRef.current,
    })

    const ns = clientRef.current.session.get(topicRef.current)?.namespaces?.stellar
    const addr = ns?.accounts?.length ? caip10ToAddress(ns.accounts[0]) : undefined
    return {
      signedTxXdr: result.signedXDR,
      signerAddress: addr,
    }
  }, [])

  const connect: IWallet['connect'] = useCallback(async () => {
    const client = await ensureClient()
    const { approval, uri } = await client.connect({
      requiredNamespaces: {
        stellar: {
          chains: [STELLAR_CHAIN],
          events: [],
          methods: [WC_METHOD_SIGN],
        },
      },
    })

    if (!uri) throw new Error('No WalletConnect URI')

    const modal = ensureModal()
    await modal.openModal({ uri })
    const session = await approval()
    topicRef.current = session.topic

    // Persist session (auto-recover on reload)
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ topic: topicRef.current }))

    await modal.closeModal()

    const { address } = await getAddress()
    setAddress(address)
    if (!address) throw new Error('Failed to get wallet address')

    const { message } = await walletAuth.getChallengeMessage({ address })
    const { signedTxXdr } = await signTransaction({ message })
    const { token } = await walletAuth.getAuthToken({
      address,
      signedMessage: signedTxXdr,
    })
    walletAuth.setJwtToken(token)
  }, [
    ensureClient,
    ensureModal,
    getAddress,
    signTransaction,
    walletAuth,
  ])

  const disconnect = useCallback(async () => {
    const client = await ensureClient()
    if (topicRef.current) {
      await client.disconnect({
        reason: getSdkError('USER_DISCONNECTED'),
        topic: topicRef.current,
      })
      topicRef.current = undefined
      if (typeof window !== 'undefined') {
        localStorage.removeItem(SESSION_STORE_KEY)
      }
    }
    setAddress(null)
    walletAuth.setJwtToken(null)
  }, [ensureClient, walletAuth])

  return {
    address,
    connect,
    disconnect,
    signTransaction,
    walletId: 'wallet-connect',
  }
}
