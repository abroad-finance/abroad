import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
import { getSdkError } from '@walletconnect/utils'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { IWallet, WalletConnectRequest } from '../../interfaces/IWallet'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

import { WALLET_CONNECT_ID } from '../../shared/constants'

const SESSION_STORE_PREFIX = 'wc:session:'

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

const buildStoreKey = (chainId: string) => `${SESSION_STORE_PREFIX}${chainId}`

const caip10ToAddress = (caip10: string) => {
  const parts = caip10.split(':')
  return parts[2] ?? ''
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const resolveNamespaceFromChainId = (chainId: string): string => {
  if (chainId.startsWith('eip155:')) return 'eip155'
  if (chainId.startsWith('solana:')) return 'solana'
  if (chainId.startsWith('stellar:')) return 'stellar'
  return 'eip155'
}

const resolveStellarNetwork = (chainId: string): 'PUBLIC' | 'TESTNET' => {
  return chainId.toLowerCase().includes('test') ? 'TESTNET' : 'PUBLIC'
}

export function useWalletConnectWallet({ walletAuth }: {
  walletAuth: IWalletAuthentication
},
): IWallet {
  const clientRef = useRef<null | SignClient>(null)
  const topicRef = useRef<string | undefined>(undefined)
  const modalRef = useRef<null | WalletConnectModal>(null)

  const [address, setAddress] = useState<null | string>(null)
  const [chainId, setChainId] = useState<null | string>(null)

  const ensureModal = useCallback(() => {
    if (typeof window === 'undefined') {
      throw new Error('WalletConnect modal is only available in the browser')
    }
    if (!modalRef.current) {
      modalRef.current = new WalletConnectModal({ projectId: WALLET_CONNECT_ID })
    }
    return modalRef.current
  }, [])

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

      client.on('session_delete', () => {
        topicRef.current = undefined
        if (typeof window !== 'undefined' && chainId) {
          localStorage.removeItem(buildStoreKey(chainId))
        }
      })
    }
    return clientRef.current
  }, [chainId])

  const tryRestoreSession = useCallback(async (client: SignClient, targetChainId: string, namespace: string) => {
    if (typeof window === 'undefined') return false
    const raw = localStorage.getItem(buildStoreKey(targetChainId))
    if (!raw) return false
    try {
      const { topic } = JSON.parse(raw) as { topic?: string }
      if (!topic) return false
      const session = client.session.get(topic)
      if (!session) {
        localStorage.removeItem(buildStoreKey(targetChainId))
        return false
      }
      topicRef.current = topic
      setChainId(targetChainId)
      const ns = session.namespaces?.[namespace]
      const caip10 = ns?.accounts?.[0]
      if (caip10) {
        setAddress(caip10ToAddress(caip10))
      }
      return true
    }
    catch {
      localStorage.removeItem(buildStoreKey(targetChainId))
      return false
    }
  }, [])

  const request = useCallback(async <TResult>(req: WalletConnectRequest): Promise<TResult> => {
    const client = await ensureClient()
    if (!topicRef.current) throw new Error('No active WalletConnect session')
    return client.request<TResult>({
      chainId: req.chainId,
      request: {
        method: req.method,
        params: req.params,
      },
      topic: topicRef.current,
    })
  }, [ensureClient])

  const signAuthMessage = useCallback(async (params: {
    address: string
    chainId: string
    message: string
  }): Promise<string> => {
    const { address, chainId, message } = params
    const namespace = resolveNamespaceFromChainId(chainId)

    if (namespace === 'solana') {
      const encoded = toBase64(new TextEncoder().encode(message))
      const result = await request<{ signature: string }>({
        chainId,
        method: 'solana_signMessage',
        params: {
          message: encoded,
          pubkey: address,
        },
      })
      return result.signature
    }

    if (namespace === 'stellar') {
      const result = await request<{ signedXDR: string }>({
        chainId,
        method: 'stellar_signXDR',
        params: {
          network: resolveStellarNetwork(chainId),
          xdr: message,
        },
      })
      return result.signedXDR
    }

    return request<string>({
      chainId,
      method: 'personal_sign',
      params: [message, address],
    })
  }, [request])

  const connect: IWallet['connect'] = useCallback(async (options) => {
    const targetChainId = options?.walletConnect?.chainId || options?.chainId
    const wcMeta = options?.walletConnect
    if (!targetChainId) throw new Error('WalletConnect chainId is required')

    const namespace = wcMeta?.namespace || resolveNamespaceFromChainId(targetChainId)
    const methods = wcMeta?.methods || (namespace === 'solana'
      ? ['solana_signMessage', 'solana_signTransaction']
      : namespace === 'stellar'
        ? ['stellar_signXDR']
        : ['personal_sign', 'eth_sendTransaction'])
    const events = wcMeta?.events || []

    const client = await ensureClient()
    const restored = await tryRestoreSession(client, targetChainId, namespace)

    // In silent mode, only restore saved sessions — never open the QR modal
    if (options?.silentRestore) {
      if (!restored) throw new Error('No saved session for this chain')
      return
    }

    if (!restored) {
      const { approval, uri } = await client.connect({
        requiredNamespaces: {
          [namespace]: {
            chains: [targetChainId],
            events,
            methods,
          },
        },
      })

      if (!uri) throw new Error('No WalletConnect URI')

      const modal = ensureModal()
      await modal.openModal({ uri, chains: [targetChainId] })
      const session = await approval()
      topicRef.current = session.topic
      await modal.closeModal()

      if (typeof window !== 'undefined') {
        localStorage.setItem(buildStoreKey(targetChainId), JSON.stringify({ topic: session.topic }))
      }
    }

    const session = client.session.get(topicRef.current as string)
    const ns = session?.namespaces?.[namespace]
    const caip10 = ns?.accounts?.[0]
    const resolvedAddress = caip10 ? caip10ToAddress(caip10) : ''

    if (!resolvedAddress) {
      throw new Error('Failed to get wallet address')
    }

    setAddress(resolvedAddress)
    setChainId(targetChainId)

    await walletAuth.authenticate({
      address: resolvedAddress,
      chainId: targetChainId,
      signMessage: (message: string) => signAuthMessage({
        address: resolvedAddress,
        chainId: targetChainId,
        message,
      }),
    })
  }, [
    ensureClient,
    ensureModal,
    signAuthMessage,
    tryRestoreSession,
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
      if (typeof window !== 'undefined' && chainId) {
        localStorage.removeItem(buildStoreKey(chainId))
      }
    }
    setAddress(null)
    setChainId(null)
    walletAuth.setJwtToken(null)
  }, [
    chainId,
    ensureClient,
    walletAuth,
  ])

  const signTransaction: IWallet['signTransaction'] = useCallback(async ({ message }) => {
    if (!chainId) throw new Error('WalletConnect chainId is not set')
    const namespace = resolveNamespaceFromChainId(chainId)

    if (namespace !== 'stellar') {
      throw new Error('signTransaction is only supported for Stellar via WalletConnect')
    }

    const result = await request<{ signedXDR: string }>({
      chainId,
      method: 'stellar_signXDR',
      params: {
        network: resolveStellarNetwork(chainId),
        xdr: message,
      },
    })

    return {
      signedTxXdr: result.signedXDR,
      signerAddress: address || undefined,
    }
  }, [
    address,
    chainId,
    request,
  ])

  return useMemo(() => ({
    address,
    chainId,
    connect,
    disconnect,
    request,
    signTransaction,
    walletId: 'wallet-connect',
  }), [
    address,
    chainId,
    connect,
    disconnect,
    request,
    signTransaction,
  ])
}

export const decodeWalletConnectSolanaTx = (base64Tx: string): Uint8Array => {
  return fromBase64(base64Tx)
}
