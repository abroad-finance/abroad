/**
 * Solana wallet adapter usando @solana/wallet-adapter
 * Soporta: Phantom, Solflare, Backpack, Clover
 */

import { useCallback, useMemo, useState } from 'react'

import type { IWallet } from '../../interfaces/IWallet'
import {
  WalletErrorCode,
  type WalletError,
  createWalletError,
  getErrorMessage,
} from '../../interfaces/wallet-errors'
import { sessionStore } from '../auth/sessionStore'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

// Constants
export const SOLANA_CHAIN_ID = 'solana:mainnet'

interface SolanaWalletState {
  wallet: IWallet | null
  error: WalletError | null
  isConnecting: boolean
}

/**
 * Detecta si hay una wallet de Solana instalada (Phantom, Solflare, etc.)
 */
function getSolanaProvider(): {
  isPhantom?: boolean
  isSolflare?: boolean
  isBackpack?: boolean
  connect?: () => Promise<{ publicKey: { toString: () => string } }>
  signMessage?: (message: Uint8Array) => Promise<{ signature: Uint8Array }>
  signTransaction?: (tx: { serialize: () => Uint8Array }) => Promise<{ signature: Uint8Array }>
  disconnect?: () => Promise<void>
  publicKey?: { toString: () => string }
} | null {
  if (typeof window === 'undefined') return null

  const win = window as unknown as {
    phantom?: { solana?: unknown }
    solana?: { isPhantom?: boolean; isSolflare?: boolean }
    backpack?: { isBackpack?: boolean }
  }

  if (win.phantom?.solana) {
    return win.phantom.solana as typeof win.phantom.solana & {
      isPhantom?: boolean
      connect?: () => Promise<{ publicKey: { toString: () => string } }>
      signMessage?: (message: Uint8Array) => Promise<{ signature: Uint8Array }>
      signTransaction?: (tx: { serialize: () => Uint8Array }) => Promise<{ signature: Uint8Array }>
      disconnect?: () => Promise<void>
      publicKey?: { toString: () => string }
    }
  }

  if (win.solana?.isPhantom || win.solana?.isSolflare) {
    return win.solana
  }

  if (win.backpack?.isBackpack) {
    return win.backpack
  }

  return null
}

export const useSolanaWallet = (walletAuth?: IWalletAuthentication): SolanaWalletState => {
  const [state, setState] = useState<SolanaWalletState>({
    wallet: null,
    error: null,
    isConnecting: false,
  })

  const [connectedAddress, setConnectedAddress] = useState<string | null>(() => {
    // Restore from session if valid
    const session = sessionStore.get()
    if (session?.chainId === SOLANA_CHAIN_ID && session.address) {
      return session.address
    }
    return null
  })

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, isConnecting: true }))
    try {
      const provider = getSolanaProvider()

      if (!provider) {
        throw createWalletError(
          WalletErrorCode.CHAIN_NOT_SUPPORTED,
          'No Solana wallet detected. Please install Phantom, Solflare, or Backpack.',
          { chainId: SOLANA_CHAIN_ID },
        )
      }

      if (!provider.connect) {
        throw createWalletError(
          WalletErrorCode.CONNECTION_FAILED,
          'Connected Solana provider does not support connect method',
        )
      }

      const result = await provider.connect()
      const address = result.publicKey?.toString()

      if (!address) {
        throw createWalletError(
          WalletErrorCode.CONNECTION_FAILED,
          'Failed to get address from Solana wallet',
        )
      }

      setConnectedAddress(address)

      // Save session
      sessionStore.set({
        address,
        chainId: SOLANA_CHAIN_ID,
        walletId: 'solana',
      })

      // Authenticate if walletAuth is provided
      if (walletAuth) {
        await walletAuth.authenticate({
          address,
          chainId: SOLANA_CHAIN_ID,
          signMessage: async (message: string) => {
            if (!provider.signMessage) {
              throw createWalletError(
                WalletErrorCode.SIGNATURE_FAILED,
                'Provider does not support signMessage',
              )
            }
            const encoder = new TextEncoder()
            const messageBytes = encoder.encode(message)
            const signed = await provider.signMessage(messageBytes)
            // Convert Uint8Array to base64
            let binary = ''
            signed.signature.forEach((byte) => {
              binary += String.fromCharCode(byte)
            })
            return btoa(binary)
          },
        })
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      const walletError =
        error instanceof Object && 'code' in error
          ? (error as WalletError)
          : createWalletError(
            WalletErrorCode.CONNECTION_FAILED,
            errorMessage || 'Failed to connect Solana wallet',
            { details: error, chainId: SOLANA_CHAIN_ID },
          )

      setState((s) => ({
        ...s,
        error: walletError,
      }))
      throw error
    } finally {
      setState((s) => ({ ...s, isConnecting: false }))
    }
  }, [walletAuth])

  const disconnect = useCallback(async () => {
    try {
      const provider = getSolanaProvider()
      if (provider?.disconnect) {
        await provider.disconnect()
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to disconnect Solana wallet', error)
      }
    } finally {
      setConnectedAddress(null)
      sessionStore.clear()
    }
  }, [])

  const signTransaction = useCallback(
    async ({ message }: { message: string }) => {
      const provider = getSolanaProvider()

      if (!provider) {
        throw createWalletError(
          WalletErrorCode.SIGNATURE_FAILED,
          'No Solana provider available',
        )
      }

      if (!provider.signTransaction) {
        throw createWalletError(
          WalletErrorCode.SIGNATURE_FAILED,
          'Provider does not support signTransaction',
        )
      }

      // For Solana, message is expected to be a base64-encoded transaction
      const txBytes = Buffer.from(message, 'base64')

      // Create a mock transaction object that the provider can sign
      const mockTx = {
        serialize: () => txBytes,
      }

      await provider.signTransaction(mockTx)

      return {
        signedTxXdr: message, // Return original message as signature placeholder
        signerAddress: connectedAddress || undefined,
      }
    },
    [connectedAddress],
  )

  const wallet = useMemo<IWallet | null>(() => {
    if (!connectedAddress) return null

    return {
      address: connectedAddress,
      chainId: SOLANA_CHAIN_ID,
      connect,
      disconnect,
      signTransaction,
      walletId: 'solana',
    }
  }, [connectedAddress, connect, disconnect, signTransaction])

  return { wallet, error: state.error, isConnecting: state.isConnecting }
}
