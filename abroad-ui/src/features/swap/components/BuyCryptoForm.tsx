import { useCallback, useState } from 'react'

import type {
  OnrampFormErrors,
  OnrampFormLimits,
} from '../shared/onrampFormModel'

import {
  hasOnrampFormErrors,
  normalizeTaxId,
  parseFiatAmount,
  validateOnrampForm,
} from '../shared/onrampFormModel'

type BuyCryptoFormProps = {
  assetLabel: string
  destinationAddress: null | string
  isSubmitting: boolean
  limits: OnrampFormLimits
  onBack: () => void
  onSubmit: (values: { fiatAmount: number, taxId: string }) => void
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

/**
 * Collects what an onramp needs beyond a payout: the BRL the customer will pay.
 *
 * A tax id can be supplied for the customer's own records but is optional and
 * unvalidated — the payer need not be the person receiving the crypto, and the
 * delivery goes to whatever wallet was given.
 */
export default function BuyCryptoForm({
  assetLabel,
  destinationAddress,
  isSubmitting,
  limits,
  onBack,
  onSubmit,
  submissionError,
  translate,
}: BuyCryptoFormProps) {
  const [fiatAmount, setFiatAmount] = useState('')
  const [taxId, setTaxId] = useState('')
  const [errors, setErrors] = useState<OnrampFormErrors>({})

  const handleSubmit = useCallback(() => {
    const nextErrors = validateOnrampForm({ fiatAmount }, limits)
    setErrors(nextErrors)
    if (hasOnrampFormErrors(nextErrors)) return

    const parsedAmount = parseFiatAmount(fiatAmount)
    if (parsedAmount === null) return

    onSubmit({ fiatAmount: parsedAmount, taxId: normalizeTaxId(taxId) })
  }, [
    fiatAmount,
    limits,
    onSubmit,
    taxId,
  ])

  const canSubmit = Boolean(destinationAddress) && !isSubmitting

  return (
    <section aria-labelledby="buy-crypto-form-heading" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold" id="buy-crypto-form-heading">
        {`${translate('buyCrypto.form.title', 'Buy')} ${assetLabel}`}
      </h2>

      <label className="flex flex-col gap-1" htmlFor="buy-crypto-amount">
        <span>{translate('buyCrypto.form.amountLabel', 'You pay (BRL)')}</span>
        <input
          aria-describedby={errors.fiatAmount ? 'buy-crypto-amount-error' : undefined}
          aria-invalid={errors.fiatAmount ? true : undefined}
          id="buy-crypto-amount"
          inputMode="decimal"
          onChange={event => setFiatAmount(event.target.value)}
          value={fiatAmount}
        />
      </label>
      {errors.fiatAmount && (
        <p id="buy-crypto-amount-error" role="alert">
          {describeAmountError(errors.fiatAmount, limits, translate)}
        </p>
      )}

      <label className="flex flex-col gap-1" htmlFor="buy-crypto-tax-id">
        <span>{translate('buyCrypto.form.cpfLabel', 'CPF (optional)')}</span>
        <input
          id="buy-crypto-tax-id"
          inputMode="numeric"
          onChange={event => setTaxId(event.target.value)}
          value={taxId}
        />
      </label>

      {destinationAddress
        ? (
            <p className="break-all text-xs" data-testid="buy-crypto-destination">
              {translate('buyCrypto.form.destination', 'Delivered to')}
              {' '}
              {destinationAddress}
            </p>
          )
        : (
            <p role="alert">
              {translate(
                'buyCrypto.form.connectWallet',
                'Connect a wallet first so we know where to send your crypto.',
              )}
            </p>
          )}

      {submissionError && <p role="alert">{submissionError}</p>}

      <div className="flex gap-2">
        <button onClick={onBack} type="button">
          {translate('buyCrypto.form.back', 'Back')}
        </button>
        <button disabled={!canSubmit} onClick={handleSubmit} type="button">
          {isSubmitting
            ? translate('buyCrypto.form.submitting', 'Getting your PIX code…')
            : translate('buyCrypto.form.submit', 'Continue')}
        </button>
      </div>
    </section>
  )
}
