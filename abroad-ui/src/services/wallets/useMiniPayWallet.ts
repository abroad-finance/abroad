import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { IWallet, WalletConnectRequest } from '../../interfaces/IWallet'
import type { MiniPayRuntime } from '../../interfaces/IWalletFactory'

import {
  getMiniPayBrowserRuntime,
  getMiniPayProvider,
  MINIPAY_CHAIN_ID,
  readMiniPaySessionAddress,
  resolveMiniPayAddress,
  sanitizeMiniPayRequest,
  writeMiniPaySessionAddress,
} from './minipay'

type MiniPayConnectionState
  = | {
      address: null
      kind: 'available'
    }
    | {
      address: null
      kind: 'inactive'
    }
    | {
      address: null | string
      kind: 'resolving'
    }
    | {
      address: string
      kind: 'ready'
    }

type MiniPayWalletState = {
  runtime: MiniPayRuntime
  wallet: IWallet
}

const createInitialConnectionState = (): MiniPayConnectionState => {
  const runtime = getMiniPayBrowserRuntime()
  if (!runtime) {
    return {
      address: null,
      kind: 'inactive',
    }
  }

  const cachedAddress = readMiniPaySessionAddress(runtime.sessionStore)
  if (cachedAddress) {
    return {
      address: cachedAddress,
      kind: 'ready',
    }
  }

  return {
    address: null,
    kind: 'available',
  }
}

const toResolvingState = (state: MiniPayConnectionState): MiniPayConnectionState => {
  if (state.kind === 'inactive') {
    return state
  }

  return {
    address: state.address,
    kind: 'resolving',
  }
}

const deriveMiniPayRuntime = (state: MiniPayConnectionState): MiniPayRuntime => {
  switch (state.kind) {
    case 'inactive':
      return {
        isActive: false,
        isReady: false,
        isResolving: false,
        status: 'inactive',
      }
    case 'available':
      return {
        isActive: true,
        isReady: false,
        isResolving: false,
        status: 'available',
      }
    case 'resolving':
      return {
        isActive: true,
        isReady: false,
        isResolving: true,
        status: 'resolving',
      }
    case 'ready':
      return {
        isActive: true,
        isReady: true,
        isResolving: false,
        status: 'ready',
      }
    default: {
      const exhaustiveCheck: never = state
      return exhaustiveCheck
    }
  }
}

export const useMiniPayWallet = (): MiniPayWalletState => {
  const [connectionState, setConnectionState] = useState<MiniPayConnectionState>(
    createInitialConnectionState,
  )
  const didBootstrapRef = useRef(false)
  const resolutionRef = useRef<null | Promise<null | string>>(null)

  const resolveAddress = useCallback(async (): Promise<null | string> => {
    const browserRuntime = getMiniPayBrowserRuntime()
    if (!browserRuntime) {
      setConnectionState({
        address: null,
        kind: 'inactive',
      })
      return null
    }

    if (resolutionRef.current) {
      return resolutionRef.current
    }

    setConnectionState(currentState => toResolvingState(currentState))

    const resolution = (async () => {
      try {
        const result = await resolveMiniPayAddress(browserRuntime)
        if (result.address) {
          setConnectionState({
            address: result.address,
            kind: 'ready',
          })
          return result.address
        }

        setConnectionState({
          address: null,
          kind: 'available',
        })
        return null
      }
      catch (error) {
        console.error('Failed to resolve MiniPay address', error)
        const cachedAddress = readMiniPaySessionAddress(browserRuntime.sessionStore)
        setConnectionState(cachedAddress
          ? {
              address: cachedAddress,
              kind: 'ready',
            }
          : {
              address: null,
              kind: 'available',
            })
        return cachedAddress
      }
      finally {
        resolutionRef.current = null
      }
    })()

    resolutionRef.current = resolution
    return resolution
  }, [])

  useEffect(() => {
    if (didBootstrapRef.current) {
      return
    }
    didBootstrapRef.current = true

    if (connectionState.kind === 'inactive') {
      return
    }

    void resolveAddress()
  }, [connectionState.kind, resolveAddress])

  const connect = useCallback(async () => {
    await resolveAddress()
  }, [resolveAddress])

  const disconnect = useCallback(async () => {
    const browserRuntime = getMiniPayBrowserRuntime()
    writeMiniPaySessionAddress(browserRuntime?.sessionStore ?? null, null)
    setConnectionState(browserRuntime
      ? {
          address: null,
          kind: 'available',
        }
      : {
          address: null,
          kind: 'inactive',
        })
  }, [])

  const request = useCallback(async <TResult,>(requestShape: WalletConnectRequest): Promise<TResult> => {
    const browserRuntime = getMiniPayBrowserRuntime()
    const provider = getMiniPayProvider(browserRuntime?.provider)
    const sanitizedRequest = sanitizeMiniPayRequest(requestShape)

    return provider.request<TResult>({
      method: sanitizedRequest.method,
      params: sanitizedRequest.params,
    })
  }, [])

  const signTransaction: IWallet['signTransaction'] = useCallback(async () => {
    throw new Error('MiniPay signs transactions through eth_sendTransaction only')
  }, [])

  const wallet = useMemo<IWallet>(() => ({
    address: connectionState.address,
    chainId: connectionState.kind === 'inactive' ? null : MINIPAY_CHAIN_ID,
    connect,
    disconnect,
    request,
    signTransaction,
    walletId: connectionState.kind === 'inactive' ? null : 'mini-pay',
  }), [
    connect,
    connectionState.address,
    connectionState.kind,
    disconnect,
    request,
    signTransaction,
  ])

  const runtime = useMemo<MiniPayRuntime>(() => (
    deriveMiniPayRuntime(connectionState)
  ), [connectionState])

  return {
    runtime,
    wallet,
  }
}
