import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type {
  OnrampQuoteView,
  PaymentInstructionsView,
} from '../shared/onrampPresentation'

import {
  arePaymentInstructionsExpired,
  formatExpiryCountdown,
  millisecondsUntilExpiry,
} from '../shared/onrampPresentation'

type BuyCryptoPixCodeProps = {
  instructions: PaymentInstructionsView
  onExpired: () => void
  onStartOver: () => void
  quote: OnrampQuoteView
  translate: (key: string, fallback: string) => string
}

const COUNTDOWN_TICK_MS = 1_000

const formatCrypto = (amount: number, currency: string): string =>
  `${amount.toFixed(6).replace(/\.?0+$/, '')} ${currency}`

const formatFiat = (amount: number, currency: string): string =>
  new Intl.NumberFormat('pt-BR', {
    currency,
    style: 'currency',
  }).format(amount)

/**
 * The PIX code a customer pays to complete a purchase.
 *
 * Expiry is driven off the provider's own `expiresAt`, and a code without one
 * simply never shows a countdown — the browser clock is not treated as
 * authoritative for whether money can still arrive.
 */
export default function BuyCryptoPixCode({
  instructions,
  onExpired,
  onStartOver,
  quote,
  translate,
}: BuyCryptoPixCodeProps) {
  const [copied, setCopied] = useState(false)
  const [remainingMs, setRemainingMs] = useState<null | number>(
    () => millisecondsUntilExpiry(instructions),
  )

  const expired = useMemo(
    () => arePaymentInstructionsExpired(instructions),
    // Recomputed on every countdown tick so the view flips the moment it lapses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instructions, remainingMs],
  )

  useEffect(() => {
    if (instructions.expiresAt === null) return undefined

    const tick = () => {
      setRemainingMs(millisecondsUntilExpiry(instructions))
    }
    const timer = setInterval(tick, COUNTDOWN_TICK_MS)
    return () => {
      clearInterval(timer)
    }
  }, [instructions])

  useEffect(() => {
    if (expired) {
      onExpired()
    }
  }, [expired, onExpired])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(instructions.brCode)
      setCopied(true)
    }
    catch {
      // A blocked clipboard must not look like a successful copy: the code
      // stays selectable on screen so the customer can copy it manually.
      setCopied(false)
    }
  }, [instructions.brCode])

  return (
    <section aria-labelledby="buy-crypto-pix-heading" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold" id="buy-crypto-pix-heading">
        {translate('buyCrypto.pix.title', 'Pay this PIX to finish')}
      </h2>

      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <dt>{translate('buyCrypto.pix.youPay', 'You pay')}</dt>
          <dd>{formatFiat(quote.targetAmount, quote.targetCurrency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{translate('buyCrypto.pix.youReceive', 'You receive')}</dt>
          <dd>{formatCrypto(quote.sourceAmount, quote.sourceCurrency)}</dd>
        </div>
      </dl>

      {expired
        ? (
            <div className="flex flex-col gap-3" role="alert">
              <p>
                {translate(
                  'buyCrypto.pix.expired',
                  'This payment code expired before it was paid. Start again to get a fresh one.',
                )}
              </p>
              <button onClick={onStartOver} type="button">
                {translate('buyCrypto.pix.startOver', 'Start again')}
              </button>
            </div>
          )
        : (
            <>
              <p className="break-all font-mono text-xs" data-testid="buy-crypto-br-code">
                {instructions.brCode}
              </p>

              <button onClick={() => void handleCopy()} type="button">
                {copied
                  ? translate('buyCrypto.pix.copied', 'Copied')
                  : translate('buyCrypto.pix.copy', 'Copy PIX code')}
              </button>

              {remainingMs !== null && (
                <p aria-live="polite">
                  {translate('buyCrypto.pix.expiresIn', 'Expires in')}
                  {' '}
                  {formatExpiryCountdown(remainingMs)}
                </p>
              )}

              <p className="text-xs">
                {translate(
                  'buyCrypto.pix.settlementNotice',
                  'We release the crypto to your wallet once the payment settles.',
                )}
              </p>
            </>
          )}
    </section>
  )
}
