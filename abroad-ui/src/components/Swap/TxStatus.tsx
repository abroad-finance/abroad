import { useTranslate } from '@tolgee/react'
import React, { useEffect, useRef, useState } from 'react'

import { TransactionStatus as ApiStatus, getTransactionStatus } from '../../api'
import { Button } from '../../shared-components/Button'
import { IconAnimated } from '../IconAnimated'

interface TxStatusProps {
  onNewTransaction: () => void
  onRetry: () => void
  transactionId: null | string
}

// UI status mapping
type UiStatus = 'accepted' | 'denied' | 'inProgress'

export default function TxStatus({ onNewTransaction, onRetry, transactionId }: TxStatusProps): React.JSX.Element {
  const { t } = useTranslate()
  const [status, setStatus] = useState<UiStatus>('inProgress')
  const [error, setError] = useState<null | string>(null)
  const pollRef = useRef<null | number>(null)

  // Map API status to UI status
  const mapStatus = (api?: ApiStatus): UiStatus => {
    switch (api) {
      case 'PAYMENT_COMPLETED': return 'accepted'
      case 'PAYMENT_FAILED':
      case 'WRONG_AMOUNT': return 'denied'
      case 'AWAITING_PAYMENT':
      case 'PROCESSING_PAYMENT':
      default: return 'inProgress'
    }
  }

  // Poll transaction status
  useEffect(() => {
    if (!transactionId) return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await getTransactionStatus(transactionId)
        if (cancelled) return
        const ui = mapStatus(res.data?.status as ApiStatus)
        setStatus(ui)
        if (ui === 'inProgress') {
          pollRef.current = window.setTimeout(poll, 1000)
        }
      }
      catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : t('tx_status.error_fetching', 'Error obteniendo estado'))
        // retry slower
        pollRef.current = window.setTimeout(poll, 1000)
      }
    }
    poll()
    return () => {
      cancelled = true
      if (pollRef.current) window.clearTimeout(pollRef.current)
    }
  }, [transactionId, t])

  const renderIcon = () => {
    switch (status) {
      case 'accepted':
        return <IconAnimated icon="AnimatedCheck" size={150} trigger="once" />
      case 'denied':
        return <IconAnimated icon="Denied" size={150} trigger="once" />
      case 'inProgress':
        return <IconAnimated icon="Coins" size={150} trigger="loop" />
    }
  }

  const renderStatusText = () => {
    switch (status) {
      case 'accepted':
        return t('tx_status.accepted', 'Retiro Realizado')
      case 'denied':
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
        className="relative w-[90%] max-w-[50vh] h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-6 flex flex-col items-center justify-center space-y-4"
        id="bg-container"
      >
        {/* Status Icon */}
        <div>
          {renderIcon()}
        </div>
        {/* Title */}
        <div className="text-2xl font-bold text-[#356E6A] text-center">
          {renderStatusText()}
        </div>

        {/* Description */}
        <div className="text-[#356E6A]/90 text-center">
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
