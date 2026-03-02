import { Loader2, WifiOff } from 'lucide-react'

import { useWebSocket } from '../../contexts/WebSocketContext'
import { useWalletAuth } from '../hooks/useWalletAuth'
import { cn } from '../utils'

export function ConnectionStatusBanner() {
  const { connected, reconnecting, reconnectFailed, manualReconnect } = useWebSocket()
  const { wallet, walletAuthentication } = useWalletAuth()
  const isAuthenticated = Boolean(walletAuthentication?.jwtToken && wallet?.address && wallet?.chainId)

  if (!isAuthenticated || connected) return null

  return (
    <div className={cn(
      'fixed bottom-4 left-1/2 -translate-x-1/2 z-50',
      'bg-ab-card border border-ab-card-border rounded-xl',
      'px-4 py-2.5 flex items-center gap-3 shadow-lg',
    )}
    >
      {reconnecting
        ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-ab-text-2 shrink-0" />
              <span className="text-sm text-ab-text-2 whitespace-nowrap">Reconectando...</span>
            </>
          )
        : (
            <>
              <WifiOff className="h-4 w-4 text-ab-error shrink-0" />
              <span className="text-sm text-ab-text-2 whitespace-nowrap">Sin conexión al servidor</span>
              {reconnectFailed && (
                <button
                  className="text-sm text-ab-green hover:underline ml-1 whitespace-nowrap"
                  type="button"
                  onClick={manualReconnect}
                >
                  Reintentar
                </button>
              )}
            </>
          )}
    </div>
  )
}
