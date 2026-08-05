import {
  ArrowLeft,
  Loader,
  Wallet,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import type {
  OnrampFormErrors,
  OnrampFormLimits,
} from '../shared/onrampFormModel'

import { TOKEN_ICONS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'
import {
  hasOnrampFormErrors,
  parseFiatAmount,
  validateOnrampForm,
} from '../shared/onrampFormModel'

type BuyCryptoFormProps = {
  assetLabel: null | string
  destinationAddress: null | string
  isSubmitting: boolean
  limits: OnrampFormLimits
  networkLabel: null | string
  onBack: () => void
  onSubmit: (values: { fiatAmount: number }) => void
  submissionError: null | string
  translate: (key: string, fallback: string) => string
}

const describeAmountError = (
  error: NonNullable<OnrampFormErrors['fiatAmount']>,
  limits: OnrampFormLimits,
  translate: BuyCryptoFormProps['translate'],
): string => {
  switch (error) {
    case 'above-maximum':
      return `${translate('buyCrypto.form.aboveMaximum', 'The most you can buy at once is')} ${limits.maxAmount ?? ''} BRL`
    case 'below-minimum':
      return `${translate('buyCrypto.form.belowMinimum', 'The least you can buy is')} ${limits.minAmount ?? ''} BRL`
    case 'malformed':
      return translate('buyCrypto.form.malformedAmount', 'Enter an amount in Reais, for example 500,00')
    case 'required':
      return translate('buyCrypto.form.amountRequired', 'Enter how much you want to spend')
  }
}

const formatLimit = (amount: number): string =>
  new Intl.NumberFormat('pt-BR', {
    currency: 'BRL',
    style: 'currency',
  }).format(amount)

/**
 * Collects the one thing an onramp needs beyond a payout: the BRL to spend.
 *
 * Nothing about the payer is asked for. Whoever pays the PIX may differ from
 * whoever receives the crypto, so the delivery goes to the connected wallet and
 * the bank's own record of the payer is all the reconciliation that exists.
 */
export default function BuyCryptoForm({
  assetLabel,
  destinationAddress,
  isSubmitting,
  limits,
  networkLabel,
  onBack,
  onSubmit,
  submissionError,
  translate,
}: BuyCryptoFormProps) {
  const [fiatAmount, setFiatAmount] = useState('')
  const [errors, setErrors] = useState<OnrampFormErrors>({})

  const handleSubmit = useCallback(() => {
    const nextErrors = validateOnrampForm({ fiatAmount }, limits)
    setErrors(nextErrors)
    if (hasOnrampFormErrors(nextErrors)) return

    const parsedAmount = parseFiatAmount(fiatAmount)
    if (parsedAmount === null) return

    onSubmit({ fiatAmount: parsedAmount })
  }, [
    fiatAmount,
    limits,
    onSubmit,
  ])

  const canSubmit = Boolean(destinationAddress) && !isSubmitting
  const asset = assetLabel ?? translate('buyCrypto.form.genericAsset', 'crypto')
  const limitsHint = limits.minAmount !== null && limits.maxAmount !== null
    ? `${formatLimit(limits.minAmount)} – ${formatLimit(limits.maxAmount)}`
    : null

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4 sm:py-8">
      <section
        aria-labelledby="buy-crypto-form-heading"
        className="flex flex-col gap-6 rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-bg-card)] p-5 shadow-[0px_4px_20px_-2px_rgba(0,0,0,0.05)] sm:p-8"
      >
        <header className="flex items-center gap-3">
          <button
            aria-label={translate('buyCrypto.form.backAria', 'Go back')}
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl transition-colors hover:bg-ab-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-5 text-ab-text" />
          </button>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-ab-text-3">
              Brazil · Pix · BRL
            </p>
            <h1 className="text-xl font-bold leading-7 text-ab-text" id="buy-crypto-form-heading">
              {`${translate('buyCrypto.form.title', 'Buy')} ${asset}`}
            </h1>
          </div>
        </header>

        <div className="flex flex-col gap-2">
          <label
            className="text-xs font-bold uppercase tracking-wide text-ab-text-3"
            htmlFor="buy-crypto-amount"
          >
            {translate('buyCrypto.form.amountLabel', 'You pay')}
          </label>
          <div
            className={cn(
              'flex items-center gap-3 rounded-2xl border bg-[var(--ab-bg-muted)] px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-[var(--ab-green)]',
              errors.fiatAmount ? 'border-ab-error/60' : 'border-ab-border',
            )}
          >
            <span aria-hidden="true" className="text-2xl font-semibold text-ab-text-3">R$</span>
            <input
              aria-describedby={errors.fiatAmount ? 'buy-crypto-amount-error' : 'buy-crypto-amount-hint'}
              aria-invalid={errors.fiatAmount ? true : undefined}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-3xl font-extrabold tabular-nums tracking-tight text-ab-text outline-none placeholder:text-ab-text-3/50"
              id="buy-crypto-amount"
              inputMode="decimal"
              onChange={event => setFiatAmount(event.target.value)}
              placeholder="0,00"
              value={fiatAmount}
            />
            <span className="shrink-0 text-sm font-semibold text-ab-text-3">BRL</span>
          </div>
          {errors.fiatAmount
            ? (
                <p className="text-sm font-medium text-ab-error" id="buy-crypto-amount-error" role="alert">
                  {describeAmountError(errors.fiatAmount, limits, translate)}
                </p>
              )
            : limitsHint && (
              <p className="text-sm text-ab-text-3" id="buy-crypto-amount-hint">
                {translate('buyCrypto.form.limits', 'Between')}
                {' '}
                {limitsHint}
              </p>
            )}
        </div>

        <section
          aria-labelledby="buy-crypto-destination-heading"
          className="rounded-2xl border border-ab-border bg-[var(--ab-bg-muted)] p-4"
        >
          <h2
            className="text-xs font-bold uppercase tracking-wide text-ab-text-3"
            id="buy-crypto-destination-heading"
          >
            {translate('buyCrypto.form.destinationHeading', 'Delivered to')}
          </h2>
          {destinationAddress
            ? (
                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm text-ab-text-3">
                      <Wallet aria-hidden="true" className="size-4" />
                      {translate('buyCrypto.form.wallet', 'Wallet')}
                    </span>
                    {/* Shown in full: this is where the money lands, and a
                        truncated address cannot be checked against a wallet. */}
                    <span
                      className="break-all font-mono text-xs leading-5 text-ab-text"
                      data-testid="buy-crypto-destination"
                    >
                      {destinationAddress}
                    </span>
                  </div>
                  {(assetLabel || networkLabel) && (
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="shrink-0 text-sm text-ab-text-3">
                        {translate('buyCrypto.form.network', 'Network')}
                      </span>
                      <span className="flex min-w-0 items-center justify-end gap-2 text-right text-sm font-semibold text-ab-text">
                        {assetLabel && (
                          <img
                            alt=""
                            aria-hidden="true"
                            className="size-4 shrink-0 object-contain"
                            src={TOKEN_ICONS[assetLabel] ?? TOKEN_ICONS.USDC}
                          />
                        )}
                        <span className="truncate">{networkLabel ?? assetLabel}</span>
                      </span>
                    </div>
                  )}
                </div>
              )
            : (
                <p className="mt-3 text-sm leading-5 text-ab-text-3" role="alert">
                  {translate(
                    'buyCrypto.form.connectWallet',
                    'Connect a wallet first so we know where to send your crypto.',
                  )}
                </p>
              )}
        </section>

        {submissionError && (
          <div className="rounded-2xl border border-ab-error/40 bg-ab-error/10 p-4" role="alert">
            <p className="text-sm font-semibold text-ab-error">{submissionError}</p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          className="min-h-12 rounded-2xl border border-ab-border px-4 text-base font-semibold text-ab-text-secondary transition-colors hover:bg-ab-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
          disabled={isSubmitting}
          onClick={onBack}
          type="button"
        >
          {translate('buyCrypto.form.back', 'Back')}
        </button>
        <button
          aria-busy={isSubmitting}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ab-green px-4 text-base font-semibold text-white shadow-[0px_10px_15px_-3px_rgba(15,190,123,0.3)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)] focus-visible:ring-offset-2"
          disabled={!canSubmit}
          onClick={handleSubmit}
          type="button"
        >
          {isSubmitting && <Loader aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />}
          {isSubmitting
            ? translate('buyCrypto.form.submitting', 'Getting your PIX code…')
            : translate('buyCrypto.form.submit', 'Continue')}
        </button>
      </div>
    </main>
  )
}
