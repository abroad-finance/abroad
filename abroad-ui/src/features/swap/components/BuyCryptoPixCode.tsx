import { useTranslate } from '@tolgee/react'
import {
  Check,
  Clock,
  Copy,
  Info,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
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

import { TOKEN_ICONS } from '../../../shared/constants'
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
}

const COUNTDOWN_TICK_MS = 1_000

/** Below this the countdown turns red: the customer needs to act now. */
const URGENT_REMAINING_MS = 60_000

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
}: BuyCryptoPixCodeProps) {
  const { t } = useTranslate()
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

  const urgent = remainingMs !== null && remainingMs <= URGENT_REMAINING_MS

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4 sm:py-8">
      <section
        aria-labelledby="buy-crypto-pix-heading"
        className="flex flex-col gap-6 rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-bg-card)] p-5 shadow-[0px_4px_20px_-2px_rgba(0,0,0,0.05)] sm:p-8"
      >
        <header className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ab-text-3">
            Brazil · Pix · BRL
          </p>
          <h1 className="text-xl font-bold leading-7 text-ab-text" id="buy-crypto-pix-heading">
            {t('buyCrypto.pix.title', 'Pay this Pix to finish')}
          </h1>
        </header>

        <div className="flex flex-col items-center gap-2 text-center">
          <span className="break-all text-4xl font-extrabold tracking-tight text-ab-text sm:text-5xl">
            {formatFiat(quote.targetAmount, quote.targetCurrency)}
          </span>
          <div className="flex items-center gap-2 text-lg font-medium text-ab-text-3">
            <span aria-hidden="true">=</span>
            <img
              alt=""
              aria-hidden="true"
              className="size-5 shrink-0 object-contain"
              src={TOKEN_ICONS[quote.sourceCurrency] ?? TOKEN_ICONS.USDC}
            />
            <span>{formatCrypto(quote.sourceAmount, quote.sourceCurrency)}</span>
          </div>
        </div>

        {expired
          ? (
              <div className="rounded-2xl border border-ab-error/40 bg-ab-error/10 p-4" role="alert">
                <p className="text-sm font-semibold text-ab-error">
                  {t(
                    'buyCrypto.pix.expired',
                    'This payment code expired before it was paid. Start again to get a fresh one.',
                  )}
                </p>
                <button
                  className="mt-3 min-h-11 rounded-xl border border-ab-error/40 px-4 text-sm font-semibold text-ab-error transition-colors hover:bg-ab-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ab-error"
                  onClick={onStartOver}
                  type="button"
                >
                  {t('buyCrypto.pix.startOver', 'Start again')}
                </button>
              </div>
            )
          : (
              <>
                {remainingMs !== null && (
                  <div
                    aria-live="polite"
                    className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold tabular-nums ${
                      urgent
                        ? 'border-ab-error/40 bg-ab-error/10 text-ab-error'
                        : 'border-ab-border bg-[var(--ab-bg-muted)] text-ab-text-3'
                    }`}
                  >
                    <Clock aria-hidden="true" className="size-4" />
                    {t('buyCrypto.pix.expiresIn', 'Expires in')}
                    {' '}
                    {formatExpiryCountdown(remainingMs)}
                  </div>
                )}

                {/* Generated from the BR Code rather than loaded from the
                    provider's image URL: it survives a reload, needs no third
                    party to be reachable, and does not tell that third party
                    who is looking at the code. Always dark-on-white with a
                    quiet zone, whatever the page theme, or scanners fail. */}
                <div className="flex justify-center">
                  <div className="rounded-2xl bg-white p-4 shadow-[0px_4px_12px_-4px_rgba(0,0,0,0.12)]">
                    <QRCodeSVG
                      aria-label={t('buyCrypto.pix.qrAlt', 'PIX QR code for this payment')}
                      bgColor="#ffffff"
                      className="h-auto w-full max-w-[13.5rem]"
                      data-testid="buy-crypto-qr"
                      fgColor="#000000"
                      level="M"
                      marginSize={2}
                      role="img"
                      size={216}
                      value={instructions.brCode}
                    />
                  </div>
                </div>

                <section
                  aria-labelledby="buy-crypto-code-heading"
                  className="rounded-2xl border border-ab-border bg-[var(--ab-bg-muted)] p-4"
                >
                  <h2
                    className="text-xs font-bold uppercase tracking-wide text-ab-text-3"
                    id="buy-crypto-code-heading"
                  >
                    {t('buyCrypto.pix.codeHeading', 'Pix copy and paste')}
                  </h2>
                  <p
                    className="mt-3 max-h-32 select-all overflow-y-auto break-all rounded-xl bg-[var(--ab-bg-card)] p-3 font-mono text-xs leading-5 text-ab-text"
                    data-testid="buy-crypto-br-code"
                  >
                    {instructions.brCode}
                  </p>
                </section>

                <button
                  className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ab-green px-4 text-base font-semibold text-white shadow-[0px_10px_15px_-3px_rgba(15,190,123,0.3)] transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)] focus-visible:ring-offset-2"
                  onClick={() => void handleCopy()}
                  type="button"
                >
                  {copied
                    ? <Check aria-hidden="true" className="size-5" />
                    : <Copy aria-hidden="true" className="size-5" />}
                  {copied
                    ? t('buyCrypto.pix.copied', 'Copied')
                    : t('buyCrypto.pix.copy', 'Copy PIX code')}
                </button>

                <div className="flex gap-3 rounded-2xl bg-ab-separator/60 p-4">
                  <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ab-text" />
                  <p className="text-sm leading-5 text-ab-text-3">
                    {t(
                      'buyCrypto.pix.settlementNotice',
                      'We release the crypto to your wallet once the payment settles.',
                    )}
                  </p>
                </div>
              </>
            )}
      </section>
    </main>
  )
}
