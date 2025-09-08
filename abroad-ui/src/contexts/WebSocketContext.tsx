import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

import { useWalletAuth } from '../shared/hooks/useWalletAuth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void

interface WebSocketApi {
  connected: boolean
  error: null | string
  off: (event: string, handler: Listener) => void
  on: (event: string, handler: Listener) => void
}

const WebSocketContext = createContext<WebSocketApi>({
  connected: false,
  error: null,
  off: () => { },
  on: () => { },
})

function resolveWsUrl(): string {
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

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { address } = useWalletAuth()
  const socketRef = useRef<null | Socket>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<null | string>(null)
  // Keep desired listeners even across reconnects
  const listenersRef = useRef(new Map<string, Set<Listener>>())

  const attachAll = useCallback((socket: Socket) => {
    listenersRef.current.forEach((set, event) => {
      set.forEach(fn => socket.on(event, fn))
    })
  }, [])

  useEffect(() => {
    // No address → no connection
    if (!address) {
      setConnected(false)
      setError(null)
      socketRef.current?.disconnect()
      socketRef.current = null
      return
    }
    const url = resolveWsUrl()
    const socket = io(url, { auth: { userId: address }, transports: ['websocket'] })
    socketRef.current = socket

    const onConnect = () => {
      setConnected(true)
      setError(null)
      attachAll(socket)
    }
    const onDisconnect = () => setConnected(false)
    const onConnectError = (err: Error) => setError(err.message || 'WS connection error')

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)

    // Attach any registered listeners immediately
    attachAll(socket)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [address, attachAll])

  const on = useCallback((event: string, handler: Listener) => {
    // Track desired listener
    const set = listenersRef.current.get(event) ?? new Set<Listener>()
    set.add(handler)
    listenersRef.current.set(event, set)
    // Attach to current socket if ready
    const s = socketRef.current
    if (s) s.on(event, handler)
  }, [])

  const off = useCallback((event: string, handler: Listener) => {
    const set = listenersRef.current.get(event)
    if (set) {
      set.delete(handler)
      if (set.size === 0) listenersRef.current.delete(event)
    }
    const s = socketRef.current
    if (s) s.off(event, handler)
  }, [])

  const value = useMemo<WebSocketApi>(() => ({ connected, error, off, on }), [
    on,
    off,
    connected,
    error,
  ])

  return (
    <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>
  )
}

export function useWebSocket(): WebSocketApi {
  return useContext(WebSocketContext)
}
