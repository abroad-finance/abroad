import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { IWallet } from '../../interfaces/IWallet'
import type { MiniPayRuntime } from '../../interfaces/IWalletFactory'

import {
  getMiniPayProvider,
  isMiniPayEnvironment,
  MINIPAY_CHAIN_ID,
  readMiniPaySessionAddress,
  resolveMiniPayAddress,
  sanitizeMiniPayTransactionParams,
  writeMiniPaySessionAddress,
} from './minipay'

type MiniPayWalletState = {
  runtime: MiniPayRuntime
  wallet: IWallet
}

export const useMiniPayWallet = (): MiniPayWalletState => {
  const isAvailable = isMiniPayEnvironment()
  const [address, setAddress] = useState<null | string>(() => (
    isAvailable ? readMiniPaySessionAddress() : null
  ))
  const [isResolving, setIsResolving] = useState(false)
  const resolutionRef = useRef<null | Promise<null | string>>(null)

  const resolveAddress = useCallback(async (): Promise<null | string> => {
    if (!isAvailable) {
      setAddress(null)
      return null
    }

    if (resolutionRef.current) {
      return resolutionRef.current
    }

    const resolution = (async () => {
      setIsResolving(true)
      try {
        const resolvedAddress = await resolveMiniPayAddress()
        setAddress(resolvedAddress)
        return resolvedAddress
      }
      catch (error) {
        console.error('Failed to resolve MiniPay address', error)
        setAddress(readMiniPaySessionAddress())
        return readMiniPaySessionAddress()
      }
      finally {
        setIsResolving(false)
        resolutionRef.current = null
      }
    })()

    resolutionRef.current = resolution
    return resolution
  }, [isAvailable])

  useEffect(() => {
    if (!isAvailable) {
      return
    }
    void resolveAddress()
  }, [isAvailable, resolveAddress])

  const connect = useCallback(async () => {
    await resolveAddress()
  }, [resolveAddress])

  const disconnect = useCallback(async () => {
    writeMiniPaySessionAddress(null)
    setAddress(null)
  }, [])

  const request = useCallback(async <TResult,>(requestShape: {
    chainId: string
    method: string
    params: Array<unknown> | Record<string, unknown>
  }): Promise<TResult> => {
    const provider = getMiniPayProvider()
    const result = await provider.request<TResult>({
      method: requestShape.method,
      params: sanitizeMiniPayTransactionParams(requestShape.params),
    })
    return result
  }, [])

  const signTransaction: IWallet['signTransaction'] = useCallback(async () => {
    throw new Error('MiniPay signs transactions through eth_sendTransaction only')
  }, [])

  const wallet = useMemo<IWallet>(() => ({
    address,
    chainId: isAvailable ? MINIPAY_CHAIN_ID : null,
    connect,
    disconnect,
    request,
    signTransaction,
    walletId: isAvailable ? 'mini-pay' : null,
  }), [
    address,
    connect,
    disconnect,
    isAvailable,
    request,
    signTransaction,
  ])

  const runtime = useMemo<MiniPayRuntime>(() => ({
    isActive: isAvailable,
    isReady: isAvailable && Boolean(address),
    isResolving,
  }), [
    address,
    isAvailable,
    isResolving,
  ])

  return {
    runtime,
    wallet,
  }
}
