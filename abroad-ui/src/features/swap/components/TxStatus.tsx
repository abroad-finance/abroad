import { useTranslate } from '@tolgee/react'
import { Check } from 'lucide-react'
import React, {
  memo, useCallback, useEffect, useState,
} from 'react'

import { TransactionStatus as ApiStatus, _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { useWebSocketSubscription } from '../../../contexts/WebSocketContext'
import { getTransactionStatus } from '../../../services/public/publicApi'
import { Button } from '../../../shared/components/Button'
import { IconAnimated } from '../../../shared/components/IconAnimated'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'
import { cn } from '../../../shared/utils'
import { ASSET_URLS } from '../../../shared/constants'

const CHAIN_ICON_URL: Record<string, string> = {
  Celo: ASSET_URLS.CELO_CHAIN_ICON,
  Solana: ASSET_URLS.SOLANA_CHAIN_ICON,
  Stellar: ASSET_URLS.STELLAR_CHAIN_ICON,
}

const CURRENCY_FLAG_URL: Record<string, string> = {
  BRL: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
  COP: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
}

export type TxStatusDetails = {
  accountNumber: string
  network: string
  rail: string
  sourceAmount: string
  targetAmount: string
  transferFeeDisplay: string
}

interface TxStatusProps {
  onNewTransaction: () => void
  onRetry: () => void
  targetAmount: string
  targetCurrency: TargetCurrency
  transactionId: null | string
  txStatusDetails?: TxStatusDetails
}

// UI status mapping
type UiStatus = 'accepted' | 'denied' | 'inProgress'

const TxStatus = ({
  onNewTransaction,
  onRetry,
  targetAmount,
  targetCurrency,
  transactionId,
  txStatusDetails,
}: TxStatusProps): React.JSX.Element => {
  const { t } = useTranslate()
  const { wallet } = useWalletAuth()
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
    if (!transactionId || !wallet?.address || !wallet?.chainId) return
    if (!payload || payload.id !== transactionId) return
    const apiStatusValue = payload.status
    setApiStatus(apiStatusValue)
    setStatus(mapStatus(apiStatusValue))
  }, [
    wallet?.address,
    wallet?.chainId,
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

  // REST polling fallback when WebSocket doesn't deliver (e.g. timeout, disconnect)
  const TERMINAL_STATUSES: ApiStatus[] = ['PAYMENT_COMPLETED', 'PAYMENT_EXPIRED', 'PAYMENT_FAILED', 'WRONG_AMOUNT']
  const pollIntervalMs = 3000
  const maxPollAttempts = 60 // 3 minutes

  useEffect(() => {
    if (!transactionId || status !== 'inProgress') return

    const isTerminal = (s?: ApiStatus) => s != null && TERMINAL_STATUSES.includes(s)
    let cancelled = false
    let attempts = 0

    const poll = async () => {
      if (cancelled || attempts >= maxPollAttempts) return

      attempts += 1
      const result = await getTransactionStatus(transactionId)
      if (cancelled) return
      if (!result.ok || !result.data) {
        scheduleNext()
        return
      }

      const { status: apiStatusValue } = result.data
      if (isTerminal(apiStatusValue)) {
        setError(null) // clear WebSocket error when we get status via REST
        setApiStatus(apiStatusValue)
        setStatus(mapStatus(apiStatusValue))
        return
      }

      scheduleNext()
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const scheduleNext = () => {
      if (cancelled || attempts >= maxPollAttempts) return
      timeoutId = setTimeout(poll, pollIntervalMs)
    }

    void poll()

    return () => {
      cancelled = true
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [transactionId, status, mapStatus])

  const renderIcon = () => {
    switch (status) {
      case 'accepted':
        return (
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-ab-green opacity-20 blur-[12px]" />
            <div
              className={cn(
                'relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full shadow-[0px_0px_20px_0px_rgba(16,185,129,0.3)]',
                'bg-ab-green',
              )}
            >
              <Check className="h-7 w-9 text-white" strokeWidth={3} />
            </div>
          </div>
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

  const DetailRow = ({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) => (
    <div className={cn('flex items-center justify-between border-b border-ab-border pb-[17px]', className)}>
      <span className="text-base font-normal text-ab-text-3">{label}</span>
      <span className="text-base font-medium text-ab-text">{value}</span>
    </div>
  )

  if (status === 'accepted' && txStatusDetails) {
    const merchant = txStatusDetails.accountNumber || '—'
    const amountStr = getAmount(targetCurrency, targetAmount)
    const amountDisplay = amountStr != null ? `${amountStr} ${targetCurrency}` : `$${targetAmount} ${targetCurrency}`

    return (
      <div className="flex flex-1 flex-col items-center justify-center w-full max-w-[448px]">
        {error && status !== 'accepted' ? <div className="text-ab-error text-sm">{error}</div> : null}

        <div className="flex w-full flex-col items-center">
          {/* Success icon – Figma 17:93 */}
          <div className="mb-8">{renderIcon()}</div>

          {/* Title – Figma 17:50 */}
          <h1 className="mb-2 text-center text-[30px] font-bold leading-9 text-ab-text">
            {t('tx_status.payment_confirmed', 'Payment Confirmed!')}
          </h1>

          {/* Subtitle – Figma 17:53 */}
          <p className="mb-10 text-center text-base font-medium text-ab-text-3">
            {t('tx_status.settled_via', 'Settled via {rail}', { rail: txStatusDetails.rail })}
          </p>

          {/* Transaction details card – Figma 17:55 */}
          <div className="mb-8 w-full overflow-hidden rounded-[24px] border border-ab-border bg-ab-input shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
            <div className="flex flex-col gap-5 p-6">
              <DetailRow
                label={t('tx_status.merchant', 'Merchant')}
                value={merchant}
              />
              <DetailRow
                label={t('tx_status.amount', 'Amount')}
                value={<span className="font-bold">{amountDisplay}</span>}
              />
              <DetailRow
                label={t('tx_status.deducted', 'Deducted')}
                value={<span className="font-bold">$ {txStatusDetails.sourceAmount} USDC</span>}
              />
              <DetailRow
                label={t('tx_status.fee', 'Fee')}
                value={txStatusDetails.transferFeeDisplay}
              />
              <DetailRow
                label={t('tx_status.network', 'Network')}
                value={
                  <span className="flex items-center gap-2">
                    {CHAIN_ICON_URL[txStatusDetails.network] ? (
                      <img
                        alt={txStatusDetails.network}
                        className="h-4 w-4 shrink-0 object-contain"
                        src={CHAIN_ICON_URL[txStatusDetails.network]}
                      />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full bg-ab-text" />
                    )}
                    <span>{txStatusDetails.network || 'Stellar'}</span>
                  </span>
                }
              />
              <div className="flex items-center justify-between">
                <span className="text-base font-normal text-ab-text-3">{t('tx_status.rail', 'Rail')}</span>
                <span className="flex items-center gap-2 text-base font-medium text-ab-text">
                  {CURRENCY_FLAG_URL[targetCurrency] && (
                    <img
                      alt={targetCurrency}
                      className="h-4 w-4 shrink-0 object-contain"
                      src={CURRENCY_FLAG_URL[targetCurrency]}
                    />
                  )}
                  <span>
                    {targetCurrency === TargetCurrency.BRL ? 'BR ' : 'CO '}
                    {txStatusDetails.rail}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Done button – Figma 17:96 */}
          <Button
            className="w-full rounded-2xl bg-ab-green py-4 text-base font-semibold text-white shadow-[0px_10px_15px_-3px_rgba(16,185,129,0.2),0px_4px_6px_-4px_rgba(16,185,129,0.2)] hover:opacity-95"
            onClick={onNewTransaction}
            type="button"
          >
            {t('tx_status.action.done', 'Done')}
          </Button>
        </div>
      </div>
    )
  }

  // inProgress and denied states
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
            {t('tx_status.in_progress.wait', 'Esto tomará algunos segundos.')}
          </>
        )
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center w-full space-y-6">
      {error && <div className="text-ab-error text-sm">{error}</div>}

      <div
        className="relative w-full max-w-md min-h-[60vh] rounded-2xl bg-ab-card/5 p-6 backdrop-blur-xl flex flex-col items-center justify-center space-y-4"
        id="bg-container"
      >
        <div>{renderIcon()}</div>
        <div className="text-center text-2xl font-bold text-ab-text">
          {renderStatusText()}
        </div>
        <div className="text-center text-ab-text-3">
          {renderSubtitle()}
        </div>
      </div>

      {status === 'accepted' && !txStatusDetails && (
        <Button className="mt-4 w-full py-4" onClick={onNewTransaction}>
          {t('tx_status.action.new_transaction', 'Realizar otra transacción')}
        </Button>
      )}

      {status === 'denied' && (
        <Button className="mt-4 w-full py-4" onClick={onRetry}>
          {t('tx_status.action.retry', 'Intentar Nuevamente')}
        </Button>
      )}
    </div>
  )
}

export default memo(TxStatus)
