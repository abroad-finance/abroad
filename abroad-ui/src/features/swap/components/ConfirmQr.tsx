import { useTranslate } from '@tolgee/react'
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader,
} from 'lucide-react'
import React, {
  memo,
  useMemo,
  useState,
} from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { CURRENCY_FLAG_URL, TOKEN_ICONS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'
import { maskRecipient } from '../shared/recipientPresentation'

export interface ConfirmQrProps {
  accountNumber?: string
  currency: TargetCurrency
  exchangeRateDisplay: string
  feeDisplay: null | string
  loadingSubmit?: boolean
  networkLabel: string
  onBack: () => void
  onConfirm: () => void
  onEdit: () => void
  onRefreshQuote: () => void
  pixKey?: string
  quoteExpired: boolean
  quoteRemainingSeconds: null | number
  recipientName?: string
  selectedAssetLabel?: string
  sourceAmount?: string
  targetAmount?: string
  timingDisplay: null | string
}

const ConfirmQr: React.FC<ConfirmQrProps> = ({
  accountNumber,
  currency,
  exchangeRateDisplay,
  feeDisplay,
  loadingSubmit = false,
  networkLabel,
  onBack,
  onConfirm,
  onEdit,
  onRefreshQuote,
  pixKey,
  quoteExpired,
  quoteRemainingSeconds,
  recipientName,
  selectedAssetLabel = 'USDC',
  sourceAmount,
  targetAmount,
  timingDisplay,
}) => {
  const { t } = useTranslate()
  const [recipientRevealed, setRecipientRevealed] = useState(false)
  const isBRL = currency === TargetCurrency.BRL
  const recipientValue = (isBRL ? pixKey : accountNumber)?.trim() ?? ''
  const rail = isBRL ? 'Pix' : 'BRE-B'
  const targetSymbol = isBRL ? 'R$' : '$'

  const quoteValidity = useMemo(() => {
    if (quoteRemainingSeconds === null) return t('confirm_qr.quote_unavailable', 'Quote expiry unavailable')
    if (quoteRemainingSeconds <= 0 || quoteExpired) return t('confirm_qr.quote_expired', 'Quote expired')
    const minutes = Math.floor(quoteRemainingSeconds / 60)
    const seconds = quoteRemainingSeconds % 60
    return t('confirm_qr.quote_expires', 'Locked quote · expires in {minutes}:{seconds}', {
      minutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }, [
    quoteExpired,
    quoteRemainingSeconds,
    t,
  ])

  const displayedRecipient = recipientValue
    ? recipientRevealed ? recipientValue : maskRecipient(recipientValue)
    : t('confirm_qr.recipient_in_qr', 'Encoded in QR code')
  const sourceDisplay = sourceAmount ? `${sourceAmount} ${selectedAssetLabel}` : t('common.unavailable', 'Unavailable')
  const targetDisplay = targetAmount ? `${targetSymbol} ${targetAmount} ${currency}` : t('common.unavailable', 'Unavailable')

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4 sm:py-8">
      <section className="flex flex-col gap-6 rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-bg-card)] p-5 shadow-[0px_4px_20px_-2px_rgba(0,0,0,0.05)] sm:p-8">
        <header className="flex items-center gap-3">
          <button
            aria-label={t('confirm_qr.back_aria', 'Go back')}
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl transition-colors hover:bg-ab-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-5 text-ab-text" />
          </button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ab-text-3">
              {isBRL ? 'Brazil · Pix · BRL' : 'Colombia · BRE-B · COP'}
            </p>
            <h1 className="text-xl font-bold leading-7 text-ab-text">
              {t('confirm_qr.title', 'Review payment')}
            </h1>
          </div>
        </header>

        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-3">
            <img
              alt=""
              aria-hidden="true"
              className="size-8 shrink-0 rounded-full shadow-sm"
              src={CURRENCY_FLAG_URL[currency] ?? CURRENCY_FLAG_URL.COP}
            />
            <span className="break-all text-4xl font-extrabold tracking-tight text-ab-text sm:text-5xl">
              {targetSymbol}
              {' '}
              {targetAmount || '—'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-lg font-medium text-ab-text-3">
            <span aria-hidden="true">=</span>
            <img alt="" aria-hidden="true" className="size-5 shrink-0 object-contain" src={TOKEN_ICONS[selectedAssetLabel] ?? TOKEN_ICONS.USDC} />
            <span>{sourceDisplay}</span>
          </div>
        </div>

        {quoteExpired && (
          <div className="rounded-2xl border border-ab-error/40 bg-ab-error/10 p-4" role="alert">
            <p className="font-semibold text-ab-error">{t('confirm_qr.expired_message', 'The rate changed because this quote expired. Refresh it before authorizing payment.')}</p>
            <button className="mt-3 min-h-11 rounded-xl border border-ab-error/40 px-4 text-sm font-semibold text-ab-error" onClick={onRefreshQuote} type="button">
              {t('confirm_qr.refresh_quote', 'Refresh quote')}
            </button>
          </div>
        )}

        <section aria-labelledby="confirm-recipient-heading" className="rounded-2xl border border-ab-border bg-[var(--ab-bg-muted)] p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ab-text-3" id="confirm-recipient-heading">
            {t('confirm_qr.recipient_details', 'Recipient details')}
          </h2>
          {recipientName && <p className="mt-3 break-words font-semibold text-ab-text">{recipientName}</p>}
          <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
            <span className="shrink-0 text-sm text-ab-text-3">
              {isBRL ? t('confirm_qr.pix_key', 'Pix key') : t('confirm_qr.breb_key', 'Llave BRE-B')}
            </span>
            <span className="min-w-0 break-all text-right font-mono text-sm font-medium text-ab-text">{displayedRecipient}</span>
          </div>
          {recipientValue && (
            <button
              aria-pressed={recipientRevealed}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-ab-border px-3 text-sm font-semibold text-ab-text-secondary"
              onClick={() => setRecipientRevealed(current => !current)}
              type="button"
            >
              {recipientRevealed ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
              {recipientRevealed ? t('confirm_qr.hide_recipient', 'Hide recipient') : t('confirm_qr.reveal_recipient', 'Reveal recipient')}
            </button>
          )}
        </section>

        <section aria-labelledby="confirm-payment-heading" className="rounded-2xl border border-ab-border bg-[var(--ab-bg-muted)] p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ab-text-3" id="confirm-payment-heading">
            {t('confirm_qr.payment_details', 'Payment details')}
          </h2>
          <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-ab-text-3">{t('confirm_qr.rail', 'Payment rail')}</dt>
            <dd className="text-right font-semibold text-ab-text">{rail}</dd>
            <dt className="text-ab-text-3">{t('confirm_qr.network', 'Network')}</dt>
            <dd className="break-words text-right font-semibold text-ab-text">{networkLabel || t('common.unavailable', 'Unavailable')}</dd>
            <dt className="text-ab-text-3">{t('confirm_qr.you_pay', 'You pay')}</dt>
            <dd className="text-right font-semibold tabular-nums text-ab-text">{sourceDisplay}</dd>
            <dt className="text-ab-text-3">{t('confirm_qr.recipient_gets', 'Recipient gets')}</dt>
            <dd className="text-right font-semibold tabular-nums text-ab-text">{targetDisplay}</dd>
            <dt className="text-ab-text-3">{t('confirm_qr.fee', 'Fee')}</dt>
            <dd className="text-right font-semibold text-ab-text">{feeDisplay ?? t('common.unavailable', 'Unavailable')}</dd>
            <dt className="text-ab-text-3">{t('confirm_qr.rate', 'Effective rate')}</dt>
            <dd className="break-words text-right font-semibold text-ab-text">{exchangeRateDisplay}</dd>
            <dt className="text-ab-text-3">{t('confirm_qr.quote', 'Quote')}</dt>
            <dd className={cn('text-right font-semibold', quoteExpired ? 'text-ab-error' : 'text-ab-text')}>{quoteValidity}</dd>
            <dt className="text-ab-text-3">{t('confirm_qr.timing', 'Expected timing')}</dt>
            <dd className="text-right font-semibold text-ab-text">{timingDisplay ?? t('common.unavailable', 'Unavailable')}</dd>
          </dl>
        </section>

        <div className="flex gap-3 rounded-2xl bg-ab-separator/60 p-4">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ab-text" />
          <p className="text-sm leading-5 text-ab-text-3">
            {t('confirm_qr.irreversible', 'Only confirm after checking the recipient, amount, token, and network. A payment sent to the wrong recipient may not be recoverable.')}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          className="min-h-12 rounded-2xl border border-ab-border px-4 text-base font-semibold text-ab-text-secondary transition-colors hover:bg-ab-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
          disabled={loadingSubmit}
          onClick={onEdit}
          type="button"
        >
          {t('confirm_qr.edit', 'Edit details')}
        </button>
        <button
          aria-busy={loadingSubmit}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ab-green px-4 text-base font-semibold text-white shadow-[0px_10px_15px_-3px_rgba(15,190,123,0.3)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)] focus-visible:ring-offset-2"
          disabled={loadingSubmit || quoteExpired}
          onClick={onConfirm}
          type="button"
        >
          {loadingSubmit && <Loader aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />}
          {loadingSubmit
            ? t('confirm_qr.starting', 'Starting payment…')
            : t('confirm_qr.confirm_amount', 'Confirm and pay {amount}', { amount: sourceDisplay })}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {loadingSubmit ? t('confirm_qr.starting_announcement', 'Starting payment. Keep this page open.') : ''}
      </p>
    </main>
  )
}

export default memo(ConfirmQr)
