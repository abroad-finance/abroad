import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { io, type Socket } from 'socket.io-client'

import type { TransactionStatus } from '../api'

import { useWalletAuth } from '../shared/hooks/useWalletAuth'

type EventName = keyof WebSocketEventMap

type Listener<E extends EventName> = (payload: WebSocketEventMap[E]) => void

interface ListenerEntry<E extends EventName> {
  original: Listener<E>
  wrapped: (payload: unknown) => void
}

type TransactionEventPayload = { id?: string, status?: TransactionStatus }

interface WebSocketApi {
  connected: boolean
  error: null | string
  subscribe: <E extends EventName>(event: E, handler: Listener<E>) => () => void
}

interface WebSocketEventMap {
  'connect': void
  'connect_error': Error
  'disconnect': void
  'kyc.updated': { newStatus?: string }
  'transaction.created': TransactionEventPayload
  'transaction.updated': TransactionEventPayload
}

const WebSocketContext = createContext<WebSocketApi>({
  connected: false,
  error: null,
  subscribe: () => () => { },
})

const resolveWsUrl = (): string => {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined
  if (explicit) return explicit
  try {
    const api = (import.meta.env.VITE_API_URL as string | undefined) || window.location.origin
    const u = new URL(api)
    const port = (import.meta.env.VITE_WS_PORT as string | undefined) || '4000'
    return `${u.protocol}//${u.hostname}${port ? `:${port}` : ''}`
  }
  catch {
    return 'http://localhost:4000'
  }
}

const normalizePayload = <E extends EventName>(event: E, payload: unknown): WebSocketEventMap[E] => {
  if ((event === 'transaction.created' || event === 'transaction.updated' || event === 'kyc.updated') && typeof payload === 'string') {
    try {
      return JSON.parse(payload) as WebSocketEventMap[E]
    }
    catch {
      return {} as WebSocketEventMap[E]
    }
  }
  return payload as WebSocketEventMap[E]
}

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { kit } = useWalletAuth()
  const socketRef = useRef<null | Socket>(null)
  const listenersRef = useRef<Map<EventName, Set<ListenerEntry<EventName>>>>(new Map())
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const attachStoredListeners = useCallback((socket: Socket) => {
    listenersRef.current.forEach((entries, event) => {
      entries.forEach(listener => socket.on(event, listener.wrapped))
    })
  }, [])

  const subscribe = useCallback(<E extends EventName>(event: E, handler: Listener<E>) => {
    const wrapped = (payload: unknown) => handler(normalizePayload(event, payload))
    const entry: ListenerEntry<E> = { original: handler, wrapped }
    const set = listenersRef.current.get(event) ?? new Set()
    set.add(entry as ListenerEntry<EventName>)
    listenersRef.current.set(event, set as Set<ListenerEntry<EventName>>)
    const socket = socketRef.current
    if (socket) {
      const eventName = event as Parameters<Socket['on']>[0]
      const listener = wrapped as Parameters<Socket['on']>[1]
      socket.on(eventName, listener)
    }
    return () => {
      const currentSet = listenersRef.current.get(event)
      if (currentSet) {
        currentSet.forEach((value) => {
          if (value.original === handler || value.wrapped === wrapped) {
            currentSet.delete(value)
          }
        })
        if (currentSet.size === 0) listenersRef.current.delete(event)
      }
      if (socket) {
        const eventName = event as Parameters<Socket['off']>[0]
        const listener = wrapped as Parameters<Socket['off']>[1]
        socket.off(eventName, listener)
      }
    }
  }, [])

  const connectSocket = useCallback(() => {
    if (!kit?.address) return
    const url = resolveWsUrl()
    const socket = io(url, {
      auth: { userId: kit.address },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      transports: ['websocket'],
    })
    socketRef.current = socket

    const handleConnect = () => {
      setConnected(true)
      setError(null)
      attachStoredListeners(socket)
    }
    const handleDisconnect = () => {
      setConnected(false)
    }
    const handleConnectError = (err: Error) => {
      setError(err.message || 'WS connection error')
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    attachStoredListeners(socket)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      socket.disconnect()
      socketRef.current = null
    }
  }, [attachStoredListeners, kit?.address])

  useEffect(() => {
    if (!kit?.address) {
      setConnected(false)
      setError(null)
      socketRef.current?.disconnect()
      socketRef.current = null
      return
    }
    const teardown = connectSocket()
    return () => {
      teardown?.()
    }
  }, [connectSocket, kit?.address])

  const value = useMemo<WebSocketApi>(() => ({
    connected,
    error,
    subscribe,
  }), [
    connected,
    error,
    subscribe,
  ])

  return (
    <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>
  )
}

export const useWebSocket = (): WebSocketApi => useContext(WebSocketContext)

export const useWebSocketSubscription = <E extends EventName>(event: E, handler: Listener<E>) => {
  const { subscribe } = useWebSocket()
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    const unsubscribe = subscribe(event, payload => handlerRef.current(payload))
    return unsubscribe
  }, [event, subscribe])
}
