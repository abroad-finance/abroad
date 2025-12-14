import { useTranslate } from '@tolgee/react'
import React, {
  memo, useCallback, useEffect, useState,
} from 'react'

import { TransactionStatus as ApiStatus, _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { useWebSocketSubscription } from '../../../contexts/WebSocketContext'
import { Button } from '../../../shared/components/Button'
import { IconAnimated } from '../../../shared/components/IconAnimated'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'

interface TxStatusProps {
  onNewTransaction: () => void
  onRetry: () => void
  targetAmount: string
  targetCurrency: TargetCurrency
  transactionId: null | string
}

// UI status mapping
type UiStatus = 'accepted' | 'denied' | 'inProgress'

const TxStatus = ({
  onNewTransaction,
  onRetry,
  targetAmount,
  targetCurrency,
  transactionId,
}: TxStatusProps): React.JSX.Element => {
  const { t } = useTranslate()
  const { kit } = useWalletAuth()
  const [status, setStatus] = useState<UiStatus>('inProgress')
  const [apiStatus, setApiStatus] = useState<ApiStatus | undefined>(undefined)
  const [error, setError] = useState<null | string>(null)
  // no local socket, using app-wide provider

  const mapStatus = useCallback((api?: ApiStatus): UiStatus => {
    switch (api) {
      case 'PAYMENT_COMPLETED': return 'accepted'

      case 'PAYMENT_EXPIRED':
      case 'PAYMENT_FAILED':
      case 'WRONG_AMOUNT': return 'denied'

      case 'AWAITING_PAYMENT':
      case 'PROCESSING_PAYMENT':
      case undefined:
      default: return 'inProgress'
    }
  }, [])

  const getAmount = (currency: TargetCurrency, amount: string) => {
    if (currency === TargetCurrency.BRL) {
      return `R$${amount}`
    }
    else if (currency === TargetCurrency.COP) {
      return `$${amount}`
    }
  }

  const handleTxEvent = useCallback((payload: { id?: string, status?: ApiStatus }) => {
    if (!transactionId || !kit?.address) return
    if (!payload || payload.id !== transactionId) return
    const apiStatusValue = payload.status
    setApiStatus(apiStatusValue)
    setStatus(mapStatus(apiStatusValue))
  }, [
    kit?.address,
    mapStatus,
    transactionId,
  ])

  useWebSocketSubscription('transaction.created', handleTxEvent)
  useWebSocketSubscription('transaction.updated', handleTxEvent)
  useWebSocketSubscription('connect_error', (err) => {
    setError(err.message || 'WS connection error')
  })

  useEffect(() => {
    setApiStatus(undefined)
    setStatus('inProgress')
  }, [transactionId])

  const renderAmount = () => {
    if (status === 'accepted') {
      return (
        <span className="text-5xl font-bold text-abroad-dark md:text-white">
          {' '}
          {getAmount(targetCurrency, targetAmount)}
          {' '}
        </span>
      )
    }
  }

  const renderIcon = () => {
    switch (status) {
      case 'accepted':
        return (
          <IconAnimated
            icon="AnimatedCheck"
            key={`icon-${status}`}
            loop={false}
            play
            size={150}
          />
        )
      case 'denied':
        return (
          <IconAnimated
            icon="Denied"
            key={`icon-${status}`}
            loop={false}
            play
            size={150}
          />
        )
      case 'inProgress':
        return (
          <IconAnimated
            className=""
            colors="primary:#356E6A,secondary:#26A17B"
            icon="Coins"
            key={`icon-${status}`}
            loop
            play
            size={150}
          />
        )
    }
  }

  const renderStatusText = () => {
    switch (status) {
      case 'accepted':
        return t('tx_status.accepted', 'Retiro Realizado')
      case 'denied':
        if (apiStatus === 'PAYMENT_EXPIRED') {
          return t('tx_status.expired', 'Transacción Expirada')
        }
        return t('tx_status.denied', 'Transacción Rechazada')
      case 'inProgress':
        return t('tx_status.in_progress', 'Procesando Transacción')
    }
  }

  const renderSubtitle = () => {
    switch (status) {
      case 'accepted':
        return (
          <>
            {t('tx_status.accepted.super', '¡Super!')}
            <br />
            {' '}
            {t('tx_status.accepted.message', 'Todo salió bien y tu retiro ha sido exitoso.')}
          </>
        )
      case 'denied':
        if (apiStatus === 'PAYMENT_EXPIRED') {
          return <>{t('tx_status.expired.message', 'El tiempo para completar el pago se agotó y la solicitud fue cancelada. Puedes generar una nueva transacción cuando estés listo.')}</>
        }
        return <>{t('tx_status.denied.message', 'La solicitud ha sido rechazada y tus fondos han sido devueltos. Puedes intentar nuevamente más tarde.')}</>
      case 'inProgress':
        return (
          <>
            {t('tx_status.in_progress.processing', 'Tu solicitud está siendo procesada.')}
            <br />
            {' '}
            {t('tx_status.in_progress.wait', 'Esto tomará algunos segundos.')}
          </>
        )
    }
  }

  return (
    <div className=" flex-1 flex flex-col items-center justify-center w-full space-y-6">
      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div
        className="relative w-[98%] max-w-[50vh] h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-6 flex flex-col items-center justify-center space-y-4"
        id="bg-container"
      >
        {renderAmount()}
        {/* Status Icon */}
        <div>
          {renderIcon()}
        </div>
        {/* Title */}
        <div className="text-2xl font-bold  text-center text-abroad-dark md:text-white">
          {renderStatusText()}
        </div>

        {/* Description */}
        <div className="text-center text-abroad-dark md:text-white">
          {renderSubtitle()}
        </div>
      </div>

      {(status === 'accepted' || status === 'denied') && (
        <Button
          className="mt-4 w-[90%] max-w-[50vh] py-4"
          onClick={status === 'accepted' ? onNewTransaction : onRetry}
        >
          {status === 'accepted'
            ? t('tx_status.action.new_transaction', 'Realizar otra transacción')
            : t('tx_status.action.retry', 'Intentar Nuevamente')}
        </Button>
      )}
    </div>
  )
}

export default memo(TxStatus)
