import { useTranslate } from '@tolgee/react'
import { Loader2, WifiOff } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useWebSocket } from '../../contexts/WebSocketContext'
import {
  getAppTelemetrySessionKey,
  recordConsumerUxEvent,
} from '../../observability/consumerUxTelemetry'
import { useWalletAuth } from '../hooks/useWalletAuth'
import { cn } from '../utils'

export function ConnectionStatusBanner() {
  const { t } = useTranslate()
  const {
    connected,
    manualReconnect,
    reconnectFailed,
    reconnecting,
  } = useWebSocket()
  const { wallet, walletAuthentication } = useWalletAuth()
  const isAuthenticated = Boolean(walletAuthentication?.jwtToken && wallet?.address && wallet?.chainId)
  const appSessionKeyRef = useRef(getAppTelemetrySessionKey())
  const hadConnectionLossRef = useRef(false)

  useEffect(() => {
    const sessionKey = appSessionKeyRef.current
    if (!sessionKey || !isAuthenticated) return

    if (connected) {
      if (!hadConnectionLossRef.current) return
      recordConsumerUxEvent({
        dimensions: {
          action: 'refresh',
          outcome: 'reconnected',
          state: 'connection_lost',
        },
        name: 'conditional_service_action',
        session: { key: sessionKey, kind: 'app' },
      })
      hadConnectionLossRef.current = false
      return
    }

    hadConnectionLossRef.current = true
    const state = reconnectFailed
      ? 'reconnect_failed'
      : reconnecting
        ? 'reconnecting'
        : 'connection_lost'
    recordConsumerUxEvent({
      dimensions: { state },
      name: 'conditional_service_state_viewed',
      session: { key: sessionKey, kind: 'app' },
    }, { onceKey: `${sessionKey}:connection-state:${state}` })
  }, [
    connected,
    isAuthenticated,
    reconnectFailed,
    reconnecting,
  ])

  const reconnect = (): void => {
    const sessionKey = appSessionKeyRef.current
    if (sessionKey) {
      recordConsumerUxEvent({
        dimensions: {
          action: 'retry',
          outcome: 'pending',
          state: 'reconnecting',
        },
        name: 'conditional_service_action',
        session: { key: sessionKey, kind: 'app' },
      })
    }
    manualReconnect()
  }

  if (!isAuthenticated || connected) return null

  return (
    <div
      aria-live="polite"
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-50',
        'bg-ab-card border border-ab-card-border rounded-xl',
        'flex max-w-[calc(100vw-2rem)] items-center gap-3 px-4 py-2.5 shadow-lg',
      )}
      role="status"
    >
      {reconnecting
        ? (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ab-text-2 motion-reduce:animate-none" />
              <span className="text-sm text-ab-text-2 whitespace-nowrap">{t('connection.reconnecting', 'Reconnecting...')}</span>
            </>
          )
        : (
            <>
              <WifiOff className="h-4 w-4 text-ab-error shrink-0" />
              <span className="text-sm text-ab-text-2 whitespace-nowrap">{t('connection.disconnected', 'No connection to server')}</span>
              {reconnectFailed && (
                <button
                  className="ml-1 min-h-11 rounded-lg px-2 text-sm text-ab-green hover:bg-[var(--ab-green-soft)] hover:underline whitespace-nowrap"
                  onClick={reconnect}
                  type="button"
                >
                  {t('connection.retry', 'Retry')}
                </button>
              )}
            </>
          )}
    </div>
  )
}
