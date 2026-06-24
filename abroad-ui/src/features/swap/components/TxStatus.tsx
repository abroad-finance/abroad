import { useTranslate } from '@tolgee/react'
import { Check } from 'lucide-react'
import React, {
  memo, useCallback, useEffect, useState,
} from 'react'

import { TransactionStatus as ApiStatus, getTransactionStatus, _36EnumsTargetCurrency as TargetCurrency } from '@/api'
import { useWebSocketSubscription } from '@/contexts/WebSocketContext'
import { Button } from '@/shared/components/Button'
import { IconAnimated } from '@/shared/components/IconAnimated'
import {
  CHAIN_ICON_MAP, CURRENCY_FLAG_URL, RAIL_LOGO_MAP, TOKEN_ICONS,
} from '@/shared/constants'
import { useWalletAuth } from '@/shared/hooks/useWalletAuth'
import { cn } from '@/shared/utils'

// S6478: component defined at module scope (not inside parent)
const DetailRow = ({ className, label, value }: { className?: string, label: string, value: React.ReactNode }) => (
  <div className={cn('flex items-center justify-between border-b border-ab-border pb-[clamp(6px,1.5vh,14px)]', className)}>
    <span className="text-[clamp(0.7rem,2.5vw,0.875rem)] font-normal text-ab-text-3">{label}</span>
    <span className="text-[clamp(0.7rem,2.5vw,0.875rem)] font-medium text-ab-text">{value}</span>
  </div>
)

// S7776: Set.has() is O(1) vs Array.includes() O(n); defined at module scope to avoid re-creation per render
const TERMINAL_STATUSES = new Set<ApiStatus>([
  'PAYMENT_COMPLETED',
  'PAYMENT_EXPIRED',
  'PAYMENT_FAILED',
  'WRONG_AMOUNT',
])

export type TxStatusDetails = {
  accountNumber: string
  cryptoCurrency: string
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
    return null
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
    setError(err.message || t('errors.ws_connection', 'WS connection error'))
  })

  useEffect(() => {
    setApiStatus(undefined)
    setStatus('inProgress')
  }, [transactionId])

  // REST polling fallback when WebSocket doesn't deliver (e.g. timeout, disconnect)
  const pollIntervalMs = 3000
  const maxPollAttempts = 60 // 3 minutes

  useEffect(() => {
    if (!transactionId || status !== 'inProgress') return

    const isTerminal = (s?: ApiStatus) => s != null && TERMINAL_STATUSES.has(s)
    let cancelled = false
    let attempts = 0

    const poll = async () => {
      if (cancelled || attempts >= maxPollAttempts) return

      attempts += 1
      const result = await getTransactionStatus(transactionId)
      if (cancelled) return
      if (!result.data || result.status !== 200) {
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
  }, [
    transactionId,
    status,
    mapStatus,
  ])

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

  if (status === 'accepted' && txStatusDetails) {
    const merchant = txStatusDetails.accountNumber || '—'
    const amountStr = getAmount(targetCurrency, targetAmount)
    const amountDisplay = amountStr ?? `$${targetAmount} ${targetCurrency}`

    return (
      <div className="flex flex-1 flex-col items-center justify-center w-full max-w-[448px]">
        <div className="flex w-full flex-col items-center">
          {/* Success icon – Figma 17:93 */}
          <div className="mb-[clamp(0.5rem,2vh,2rem)]">{renderIcon()}</div>

          {/* Title – Figma 17:50 */}
          <h1 className="mb-1 text-center text-[clamp(1.1rem,5vw,1.6rem)] font-bold leading-tight text-ab-text">
            {t('tx_status.payment_confirmed', 'Payment Confirmed!')}
          </h1>

          {/* Subtitle – Figma 17:53 */}
          <p className="mb-[clamp(0.5rem,2vh,2rem)] text-center text-[clamp(0.7rem,2.5vw,0.875rem)] font-medium text-ab-text-3">
            {t('tx_status.settled_via', 'Settled via {rail}', { rail: txStatusDetails.rail })}
          </p>

          {/* Transaction details card – Figma 17:55 */}
          <div className="mb-[clamp(0.5rem,2vh,2rem)] w-full overflow-hidden rounded-[16px] border border-ab-border bg-ab-input shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
            <div className="flex flex-col gap-[clamp(6px,1.5vh,16px)] p-[clamp(0.75rem,3vw,1.5rem)]">
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
                value={(
                  <span className="flex items-center gap-1.5 font-bold">
                    $
                    {txStatusDetails.sourceAmount}
                    <img alt={txStatusDetails.cryptoCurrency} className="h-3.5 w-3.5" src={TOKEN_ICONS[txStatusDetails.cryptoCurrency] ?? TOKEN_ICONS.USDC} />
                  </span>
                )}
              />
              <DetailRow
                label={t('tx_status.fee', 'Fee')}
                value={txStatusDetails.transferFeeDisplay}
              />
              <DetailRow
                label={t('tx_status.network', 'Network')}
                value={(
                  <span className="flex items-center gap-2">
                    {CHAIN_ICON_MAP[txStatusDetails.network]
                      ? (
                          <img
                            alt={txStatusDetails.network}
                            className="h-4 w-4 shrink-0 object-contain"
                            src={CHAIN_ICON_MAP[txStatusDetails.network]}
                          />
                        )
                      : (
                          <span className="h-4 w-4 shrink-0 rounded-full bg-ab-text" />
                        )}
                    <span>{txStatusDetails.network || 'Stellar'}</span>
                  </span>
                )}
              />
              <div className="flex items-center justify-between">
                <span className="text-[clamp(0.7rem,2.5vw,0.875rem)] font-normal text-ab-text-3">{t('tx_status.rail', 'Rail')}</span>
                <span className="flex items-center gap-2 text-[clamp(0.7rem,2.5vw,0.875rem)] font-medium text-ab-text">
                  {CURRENCY_FLAG_URL[targetCurrency] && (
                    <img
                      alt={targetCurrency}
                      className="h-4 w-4 shrink-0 object-contain"
                      src={CURRENCY_FLAG_URL[targetCurrency]}
                    />
                  )}
                  {RAIL_LOGO_MAP[targetCurrency] && (
                    <img
                      alt={txStatusDetails.rail}
                      className="h-4 w-auto max-w-[48px] shrink-0 object-contain"
                      src={RAIL_LOGO_MAP[targetCurrency]}
                    />
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Done button – Figma 17:96 */}
          <Button
            className="w-full rounded-2xl bg-ab-green py-[clamp(0.6rem,2vh,1rem)] text-[clamp(0.8rem,3vw,1rem)] font-semibold text-white shadow-[0px_10px_15px_-3px_rgba(16,185,129,0.2),0px_4px_6px_-4px_rgba(16,185,129,0.2)] hover:opacity-95"
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
        return t('tx_status.accepted', 'Withdrawal Completed')
      case 'denied':
        if (apiStatus === 'PAYMENT_EXPIRED') {
          return t('tx_status.expired', 'Transaction Expired')
        }
        return t('tx_status.denied', 'Transaction Denied')
      case 'inProgress':
        return t('tx_status.in_progress', 'Processing Transaction')
    }
  }

  const renderSubtitle = () => {
    switch (status) {
      case 'accepted':
        return (
          <>
            {t('tx_status.accepted.super', 'Great!')}
            <br />
            {t('tx_status.accepted.message', 'Everything went well and your withdrawal was successful.')}
          </>
        )
      case 'denied':
        if (apiStatus === 'PAYMENT_EXPIRED') {
          return <>{t('tx_status.expired.message', 'The time to complete the payment has expired and the request was cancelled. You can create a new transaction when ready.')}</>
        }
        return <>{t('tx_status.denied.message', 'The request has been denied and your funds have been returned. You can try again later.')}</>
      case 'inProgress':
        return (
          <>
            {t('tx_status.in_progress.processing', 'Your request is being processed.')}
            <br />
            {t('tx_status.in_progress.wait', 'This will take a few seconds.')}
          </>
        )
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center w-full space-y-6">
      {error && <div className="text-ab-error text-sm">{error}</div>}

      <div
        className="relative w-full max-w-md py-[clamp(2.5rem,8vh,5rem)] rounded-2xl bg-ab-card/5 p-6 backdrop-blur-xl flex flex-col items-center justify-center space-y-4"
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
          {t('tx_status.action.new_transaction', 'Make another transaction')}
        </Button>
      )}

      {status === 'denied' && (
        <Button className="mt-4 w-full py-4" onClick={onRetry}>
          {t('tx_status.action.retry', 'Try Again')}
        </Button>
      )}
    </div>
  )
}

export default memo(TxStatus)
