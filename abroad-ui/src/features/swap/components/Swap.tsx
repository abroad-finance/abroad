import { useTranslate } from '@tolgee/react'
import { useReducedMotion } from 'framer-motion'
import {
  AlertCircle,
  ChevronLeft,
  Clock3,
  Wallet,
} from 'lucide-react'
import React, {
  useCallback, useEffect, useMemo, useRef,
} from 'react'

import { CurrencyToggle } from '@/components/ui'
import { ABROAD_SUPPORT_URL } from '@/shared/constants'
import { cn } from '@/shared/utils'

import type { QuoteIssue } from '../shared/quotePresentation'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'

export interface SwapProps {
  continueDisabled: boolean
  exchangeRateDisplay: string
  feeDisplay: null | string
  fromQr?: boolean
  hasInsufficientFunds?: boolean
  isAboveMaximum: boolean
  isAuthenticated: boolean
  isBelowMinimum: boolean
  isMiniPay?: boolean
  isMiniPayReady?: boolean
  loadingBalance?: boolean
  loadingSource?: boolean
  loadingTarget?: boolean
  loadingWallet?: boolean
  maximumAmountDisplay: null | string
  minimumAmountDisplay: null | string
  miniPayNotice?: null | { [key: string]: unknown, title?: string }
  networkLabel: string
  onBackClick?: () => void
  onBalanceClick?: () => void
  onOpenSourceModal?: () => void
  onOpenTargetModal?: () => void
  onPrimaryAction: () => void
  onRecipientChange?: (value: string) => void
  onRecipientEntryAbandoned?: () => void
  onRecipientHelp?: () => void
  onRetryQuote: () => void
  onSourceChange?: (value: string) => void
  onTargetChange: (value: string) => void
  quoteExpired: boolean
  quoteIssue: null | QuoteIssue
  quoteRemainingSeconds: null | number
  recipientName?: string
  recipientValue?: string
  selectCurrency?: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  selectedAssetLabel: string
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  timingDisplay: null | string
  usdcBalance?: string
  walletAddress?: null | string
  walletStatusLabel?: string
  walletStatusTone?: 'info'
}

type Translate = (key: string, fallback: string, params?: Record<string, number | string>) => string

const quoteIssueMessage = (issue: QuoteIssue, t: Translate): string => {
  switch (issue.code) {
    case 'aborted':
      return t('swap.quote_issue.aborted', 'The previous quote request stopped. Your details are still here.')
    case 'corridor-unavailable':
      return t('swap.quote_issue.corridor', 'Quotes are temporarily unavailable for this destination and payment rail.')
    case 'invalid-recipient':
      return t('swap.quote_issue.recipient', 'Check the recipient details before requesting another quote.')
    case 'liquidity-unavailable':
      return t('swap.quote_issue.liquidity', 'Available liquidity could not be confirmed. Wait a moment and try again.')
    case 'malformed-amount':
      return t('swap.quote_issue.amount', 'Enter a valid amount using numbers and a decimal separator.')
    case 'maximum':
      return t('swap.quote_issue.maximum', 'This amount is above the current corridor maximum.')
    case 'minimum':
      return t('swap.quote_issue.minimum', 'This amount is below the current corridor minimum.')
    case 'network':
      return t('swap.quote_issue.network', 'The quote service could not be reached. Check your connection and try again.')
    case 'policy':
      return t('swap.quote_issue.policy', 'This quote could not be created for the current details.')
    case 'rate-expired':
      return t('swap.quote_issue.expired', 'This quote expired. Refresh it before continuing.')
    case 'rate-limited':
      return t('swap.quote_issue.rate_limited', 'Too many quote requests were made. Wait a moment and try again.')
    case 'server':
      return t('swap.quote_issue.server', 'The quote service returned an invalid response. Try again.')
    case 'timeout':
      return t('swap.quote_issue.timeout', 'The quote request took too long. Your details are still here.')
    case 'unknown':
      return t('swap.quote_issue.unknown', 'A quote could not be created. Your details are still here.')
  }
}

const quoteActionLabel = (issue: QuoteIssue, t: Translate): string => {
  switch (issue.action) {
    case 'change-amount':
      return t('swap.quote_action.amount', 'Edit amount')
    case 'change-recipient':
      return t('swap.quote_action.recipient', 'Edit recipient')
    case 'choose-destination':
      return t('swap.quote_action.destination', 'Change destination')
    case 'retry':
      return t('swap.quote_action.retry', 'Try again')
    case 'wait-and-retry':
      return t('swap.quote_action.wait_retry', 'Try again')
  }
}

export default function Swap({
  continueDisabled,
  exchangeRateDisplay,
  feeDisplay,
  fromQr = false,
  hasInsufficientFunds = false,
  isAboveMaximum,
  isAuthenticated,
  isBelowMinimum,
  loadingBalance,
  loadingSource,
  loadingTarget,
  maximumAmountDisplay,
  minimumAmountDisplay,
  networkLabel,
  onBackClick,
  onOpenTargetModal,
  onPrimaryAction,
  onRecipientChange,
  onRecipientEntryAbandoned,
  onRecipientHelp,
  onRetryQuote,
  onTargetChange,
  quoteExpired,
  quoteIssue,
  quoteRemainingSeconds,
  recipientName,
  recipientValue = '',
  selectCurrency,
  selectedAssetLabel,
  sourceAmount,
  targetAmount,
  targetCurrency,
  timingDisplay,
  usdcBalance,
}: SwapProps): React.JSX.Element {
  const { t } = useTranslate()
  const reduceMotion = useReducedMotion()
  const amountRef = useRef<HTMLInputElement | null>(null)
  const focusScrollTimeoutRef = useRef<null | number>(null)
  const recipientRef = useRef<HTMLInputElement | null>(null)
  const latestRecipientRef = useRef(recipientValue)
  const proceededRef = useRef(false)

  useEffect(() => {
    latestRecipientRef.current = recipientValue
  }, [recipientValue])

  useEffect(() => () => {
    if (
      !fromQr
      && !proceededRef.current
      && latestRecipientRef.current.trim().length > 0
    ) {
      onRecipientEntryAbandoned?.()
    }
  }, [fromQr, onRecipientEntryAbandoned])

  useEffect(() => () => {
    if (focusScrollTimeoutRef.current !== null) {
      window.clearTimeout(focusScrollTimeoutRef.current)
    }
  }, [])

  const handleFocus = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    if (focusScrollTimeoutRef.current !== null) {
      window.clearTimeout(focusScrollTimeoutRef.current)
    }
    focusScrollTimeoutRef.current = window.setTimeout(() => {
      focusScrollTimeoutRef.current = null
      if (!input.isConnected || typeof input.scrollIntoView !== 'function') return
      input.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'center',
      })
    }, 150)
  }, [reduceMotion])

  const isBRL = targetCurrency === TargetCurrency.BRL
  const sendToPlaceholder = isBRL
    ? t('swap.send_to_placeholder_pix', 'Email, phone, or registered Pix key')
    : t('swap.send_to_placeholder_breb', 'Phone, ID, or registered Llave BRE-B')
  const recipientHint = isBRL
    ? t('swap.pix_recipient_hint', 'Use the Pix key exactly as registered by the recipient.')
    : t('swap.breb_recipient_hint', 'Use the recipient’s registered Llave BRE-B. This is not a QR payload.')
  const irreversibleWarning = t(
    'swap.irreversible_warning',
    'Check the recipient carefully. A payment sent to the wrong recipient may not be recoverable.',
  )

  const ctaDisabled = isAuthenticated && (continueDisabled || hasInsufficientFunds)
  const ctaLabelDisabled = hasInsufficientFunds
    ? t('swap.insufficient_balance', 'Insufficient balance')
    : quoteExpired
      ? t('swap.quote_expired', 'Quote expired')
      : t('swap.enter_amount', 'Enter amount')
  const formattedAmount = isBRL ? `R$ ${targetAmount}` : `$ ${targetAmount}`
  const ctaLabelEnabled = targetAmount
    ? t('swap.review_amount', 'Review {amount}', { amount: formattedAmount })
    : t('swap.continue', 'Continue')
  const activeIssue = quoteExpired
    ? { action: 'retry', code: 'rate-expired' } satisfies QuoteIssue
    : quoteIssue
  const limitMessage = isBelowMinimum
    ? minimumAmountDisplay
      ? t('swap.minimum_value', 'Minimum: {amount}', { amount: minimumAmountDisplay })
      : t('swap.minimum_unavailable', 'This amount is below the available minimum.')
    : maximumAmountDisplay
      ? t('swap.maximum_value', 'Maximum: {amount}', { amount: maximumAmountDisplay })
      : t('swap.maximum_unavailable', 'This amount is above the available maximum.')

  const quoteValidity = useMemo(() => {
    if (quoteRemainingSeconds === null) return t('swap.quote_not_ready', 'Enter an amount to request a quote')
    if (quoteRemainingSeconds <= 0) return t('swap.quote_expired', 'Quote expired')
    const minutes = Math.floor(quoteRemainingSeconds / 60)
    const seconds = quoteRemainingSeconds % 60
    return t('swap.quote_expires_in', 'Expires in {minutes}:{seconds}', {
      minutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }, [quoteRemainingSeconds, t])

  const handleIssueAction = useCallback((): void => {
    if (!activeIssue) return
    if (activeIssue.action === 'change-amount') {
      amountRef.current?.focus()
      return
    }
    if (activeIssue.action === 'change-recipient') {
      recipientRef.current?.focus()
      return
    }
    if (activeIssue.action === 'choose-destination' && onOpenTargetModal) {
      onOpenTargetModal()
      return
    }
    onRetryQuote()
  }, [
    activeIssue,
    onOpenTargetModal,
    onRetryQuote,
  ])

  const handlePrimaryAction = useCallback((): void => {
    proceededRef.current = true
    onPrimaryAction()
  }, [onPrimaryAction])

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-bg-card)] shadow-[0px_10px_40px_-10px_rgba(0,0,0,0.08)]" data-name="SwapCard">
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-center gap-3">
          {onBackClick && (
            <button
              aria-label={t('swap.back', 'Back')}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--ab-bg-subtle)] transition-colors hover:bg-[var(--ab-bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
              onClick={onBackClick}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-6 text-ab-text" strokeWidth={2.5} />
            </button>
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ab-text-muted)]">
              {isBRL ? 'Brazil · Pix · BRL' : 'Colombia · BRE-B · COP'}
            </p>
            <h1 className="text-xl font-bold leading-tight text-[var(--ab-text)]">
              {t('swap.payment_details', 'Payment details')}
            </h1>
          </div>
        </div>
        {selectCurrency && <CurrencyToggle onChange={selectCurrency} value={targetCurrency} />}
      </header>

      <section aria-label={t('swap.quote_summary', 'Quote summary')} className="border-y border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
          <span className="font-semibold text-[var(--ab-text)]">
            {t('swap.current_quote', 'Current quote')}
            :
            {' '}
            {exchangeRateDisplay}
          </span>
          <span className={cn('font-medium', quoteExpired ? 'text-ab-error' : 'text-[var(--ab-text-muted)]')}>
            {quoteValidity}
          </span>
        </div>
      </section>

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <div>
          <label className="mb-2 block text-sm font-semibold text-[var(--ab-text)]" htmlFor="swap-target-amount">
            {t('swap.recipient_amount', 'Amount the recipient receives')}
          </label>
          <div className="flex min-h-20 items-center rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 focus-within:border-[var(--ab-green)] focus-within:ring-1 focus-within:ring-[var(--ab-green)]">
            <input
              aria-describedby="swap-amount-hint swap-amount-error"
              aria-invalid={isBelowMinimum || isAboveMaximum || activeIssue?.action === 'change-amount'}
              autoFocus
              className={cn(
                'min-w-0 flex-1 bg-transparent py-3 text-right text-4xl font-black tracking-tight outline-none caret-[var(--ab-green)] placeholder:text-[var(--ab-border)]',
                (isBelowMinimum || isAboveMaximum || hasInsufficientFunds) ? 'text-ab-error' : 'text-[var(--ab-text)]',
              )}
              id="swap-target-amount"
              inputMode="decimal"
              onChange={event => onTargetChange(event.target.value)}
              onFocus={handleFocus}
              placeholder={t('input.placeholder_zero', '0')}
              ref={amountRef}
              type="text"
              value={targetAmount}
            />
            <span aria-hidden="true" className="ml-2 text-lg font-bold text-[var(--ab-text-muted)]">
              {isBRL ? 'BRL' : 'COP'}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--ab-text-muted)]" id="swap-amount-hint">
            <span>
              {t('swap.you_pay', 'You pay')}
              :
              {' '}
              {loadingSource || loadingTarget ? t('common.loading', 'Loading…') : `${sourceAmount || '—'} ${selectedAssetLabel}`}
            </span>
            {usdcBalance !== undefined && (
              <span>
                {t('swap.available_balance', 'Available balance:')}
                {' '}
                {loadingBalance ? t('common.loading', 'Loading…') : `${usdcBalance} ${selectedAssetLabel}`}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold text-ab-error" id="swap-amount-error" role={(isBelowMinimum || isAboveMaximum) ? 'alert' : undefined}>
            {(isBelowMinimum || isAboveMaximum) ? limitMessage : ''}
          </p>
        </div>

        {fromQr
          ? (
              <section aria-labelledby="swap-recipient-heading" className="rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] p-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--ab-text-muted)]" id="swap-recipient-heading">
                  {t('swap.recipient', 'Recipient')}
                </h2>
                {recipientName && <p className="mt-2 break-words font-semibold text-ab-text">{recipientName}</p>}
                <p className="mt-1 break-all font-mono text-sm text-ab-text">
                  {recipientValue || t('swap.recipient_encoded_qr', 'Recipient encoded in QR code')}
                </p>
              </section>
            )
          : (
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--ab-text)]" htmlFor="swap-send-to">
                  {isBRL ? t('swap.pix_key_label', 'Pix key') : t('swap.breb_key_label', 'Llave BRE-B')}
                </label>
                <input
                  aria-describedby="swap-recipient-hint"
                  aria-invalid={activeIssue?.action === 'change-recipient'}
                  className="min-h-12 w-full rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 py-3 text-base text-[var(--ab-text)] placeholder:text-[var(--ab-text-muted)] focus:border-[var(--ab-green)] focus:outline-none focus:ring-1 focus:ring-[var(--ab-green)]"
                  id="swap-send-to"
                  onChange={event => onRecipientChange?.(event.target.value)}
                  placeholder={sendToPlaceholder}
                  ref={recipientRef}
                  type="text"
                  value={recipientValue}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ab-text-3" id="swap-recipient-hint">
                  <p>{recipientHint}</p>
                  <a
                    className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-[var(--ab-green-dark)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
                    href={ABROAD_SUPPORT_URL}
                    onClick={onRecipientHelp}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t('swap.recipient_help', 'Need help choosing the right recipient method?')}
                  </a>
                </div>
              </div>
            )}

        {activeIssue && (
          <div className="rounded-2xl border border-ab-error/40 bg-ab-error/10 p-4" role="alert">
            <div className="flex gap-3">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ab-error" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ab-error">{quoteIssueMessage(activeIssue, t)}</p>
                <button
                  className="mt-3 min-h-11 rounded-xl border border-ab-error/40 px-4 text-sm font-semibold text-ab-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ab-error"
                  onClick={handleIssueAction}
                  type="button"
                >
                  {quoteActionLabel(activeIssue, t)}
                </button>
              </div>
            </div>
          </div>
        )}

        <section aria-label={t('swap.payment_summary', 'Payment summary')} className="rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] p-4 text-sm">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3">
            <dt className="text-[var(--ab-text-muted)]">{t('swap.network', 'Network')}</dt>
            <dd className="text-right font-semibold text-[var(--ab-text)]">{networkLabel || t('common.unavailable', 'Unavailable')}</dd>
            <dt className="text-[var(--ab-text-muted)]">{t('swap.fee', 'Fee')}</dt>
            <dd className="text-right font-semibold text-[var(--ab-text)]">{feeDisplay ?? t('common.unavailable', 'Unavailable')}</dd>
            <dt className="text-[var(--ab-text-muted)]">{t('swap.expected_timing', 'Expected timing')}</dt>
            <dd className="flex items-center justify-end gap-1 text-right font-semibold text-[var(--ab-text)]">
              <Clock3 aria-hidden="true" className="size-4" />
              {timingDisplay ?? t('common.unavailable', 'Unavailable')}
            </dd>
          </dl>
        </section>

        <p className="rounded-xl bg-ab-separator/60 p-3 text-xs leading-5 text-ab-text-3">{irreversibleWarning}</p>

        <button
          aria-busy={loadingSource || loadingTarget}
          className={cn(
            'flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)] focus-visible:ring-offset-2',
            ctaDisabled
              ? 'cursor-not-allowed bg-[var(--ab-border)] text-[var(--ab-text-muted)]'
              : 'bg-ab-btn text-ab-btn-text hover:bg-ab-btn-hover',
          )}
          disabled={ctaDisabled}
          onClick={handlePrimaryAction}
          type="button"
        >
          {!isAuthenticated
            ? (
                <span className="flex items-center gap-2">
                  <Wallet aria-hidden="true" className="size-5" />
                  {t('swap.connect_wallet_to_continue', 'Connect your wallet to continue')}
                </span>
              )
            : (hasInsufficientFunds ? ctaLabelDisabled : ctaLabelEnabled)}
        </button>
      </div>
    </main>
  )
}
