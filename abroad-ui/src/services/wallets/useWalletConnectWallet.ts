import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
import { getSdkError } from '@walletconnect/utils'
import {
  useCallback, useMemo, useRef, useState,
} from 'react'

import type { IWallet, WalletConnectRequest } from '../../interfaces/IWallet'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

import { WALLET_CONNECT_ID } from '../../shared/constants'

// Import shared utilities
import {
  WC_METADATA,
  WC_STORAGE_PREFIX,
  saveWCSession,
  getWCSession,
  clearWCSession,
  resolveNamespaceFromChainId,
  resolveStellarNetwork,
  toBase64,
  fromBase64,
} from './shared/wallet-connect-base'
import { caip10ToAddress } from './shared/wallet-utils'

const buildStoreKey = (chainId: string) => `${WC_STORAGE_PREFIX}:${chainId}`

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
        metadata: WC_METADATA,
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
    const wcSession = getWCSession(targetChainId)
    if (!wcSession?.topic) return false
    try {
      const session = client.session.get(wcSession.topic)
      if (!session) {
        clearWCSession(targetChainId)
        return false
      }
      topicRef.current = wcSession.topic
      setChainId(targetChainId)
      const ns = session.namespaces?.[namespace]
      const caip10 = ns?.accounts?.[0]
      if (caip10) {
        setAddress(caip10ToAddress(caip10))
      }
      return true
    }
    catch {
      clearWCSession(targetChainId)
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
      await modal.openModal({ chains: [targetChainId], uri })
      const session = await approval()
      topicRef.current = session.topic
      await modal.closeModal()

      // Get address from session to save it
      const savedSession = client.session.get(topicRef.current)
      const savedNs = savedSession?.namespaces?.[namespace]
      const savedCaip10 = savedNs?.accounts?.[0]
      const savedAddress = savedCaip10 ? caip10ToAddress(savedCaip10) : ''

      saveWCSession(targetChainId, {
        address: savedAddress,
        chains: [targetChainId],
        topic: session.topic,
      })
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
      if (chainId) {
        clearWCSession(chainId)
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
