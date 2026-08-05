import type { ConsumerActivityReceiptDto } from '@/api'

export type ActivityReferenceRow = {
  key: 'abroad' | 'breb' | 'on-chain' | 'pix' | 'provider' | 'refund'
  label: string
  value: string
}

export type ActivityStatusPresentation = {
  description: string
  label: string
  tone: ActivityStatusTone
}

export type ActivityStatusTone
  = | 'awaiting'
    | 'completed'
    | 'expired'
    | 'failed'
    | 'processing'
    | 'unknown'
    | 'wrong-amount'

/**
 * The translator these presenters borrow from their caller.
 *
 * Callers pass the `t` from `useTranslate()` straight in, and every parameter
 * holding one is named `t` on purpose: Tolgee's extractor collects key literals
 * from calls on a binding of that name, so renaming it makes these strings
 * invisible to the extractor and unreachable for translators.
 */
export type ActivityTranslate = (key: string, fallback: string) => string

const defaultTranslate: ActivityTranslate = (_key, fallback) => fallback

export const activityStatusPresentation = (
  status: string,
  t: ActivityTranslate = defaultTranslate,
): ActivityStatusPresentation => {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return {
        description: t('activity.status.awaiting.description', 'Waiting for the wallet transfer.'),
        label: t('activity.status.awaiting.label', 'Awaiting payment'),
        tone: 'awaiting',
      }
    case 'PAYMENT_COMPLETED':
      return {
        description: t('activity.status.completed.description', 'The local payout is confirmed.'),
        label: t('activity.status.completed.label', 'Completed'),
        tone: 'completed',
      }
    case 'PAYMENT_EXPIRED':
      return {
        description: t('activity.status.expired.description', 'The payment window expired.'),
        label: t('activity.status.expired.label', 'Expired'),
        tone: 'expired',
      }
    case 'PAYMENT_FAILED':
      return {
        description: t('activity.status.failed.description', 'The local payout did not complete.'),
        label: t('activity.status.failed.label', 'Payment failed'),
        tone: 'failed',
      }
    case 'PROCESSING_PAYMENT':
      return {
        description: t('activity.status.processing.description', 'Funds received; the local payout is being processed.'),
        label: t('activity.status.processing.label', 'Processing payment'),
        tone: 'processing',
      }
    case 'WRONG_AMOUNT':
      return {
        description: t('activity.status.wrong_amount.description', 'The received amount needs review.'),
        label: t('activity.status.wrong_amount.label', 'Amount needs review'),
        tone: 'wrong-amount',
      }
    default:
      return {
        description: t('activity.status.unknown.description', 'We cannot verify the latest payment state right now.'),
        label: t('activity.status.unknown.label', 'Status unavailable'),
        tone: 'unknown',
      }
  }
}

export const formatActivityMoney = (
  amount: number,
  currency: string,
  locale: string,
): string => {
  if (currency === 'USDC' || currency === 'USDT') {
    const value = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 6,
      minimumFractionDigits: 2,
    }).format(amount)
    return `${value} ${currency}`
  }
  return new Intl.NumberFormat(locale, {
    currency,
    currencyDisplay: 'symbol',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(amount)
}

export const formatActivityDateTime = (
  value: string,
  locale: string,
  unavailableLabel = 'Unavailable',
): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return unavailableLabel
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(date)
}

export const formatActivityRate = (
  rate: null | string,
  sourceCurrency: string,
  targetCurrency: string,
  locale: string,
): null | string => {
  if (rate === null) {
    return null
  }
  const numericRate = Number(rate)
  if (!Number.isFinite(numericRate) || numericRate <= 0) {
    return null
  }
  const formattedRate = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 8,
  }).format(numericRate)
  return `1 ${sourceCurrency} = ${formattedRate} ${targetCurrency}`
}

export const activityReferenceRows = (
  receipt: Pick<ConsumerActivityReceiptDto, 'references'>,
  t: ActivityTranslate = defaultTranslate,
): ActivityReferenceRow[] => {
  const rows: Array<ActivityReferenceRow | null> = [
    {
      key: 'abroad',
      label: t('activity.reference.abroad', 'Abroad ID'),
      value: receipt.references.abroadId,
    },
    receipt.references.pixEndToEndId
      ? {
          key: 'pix',
          label: t('activity.reference.pix', 'PIX end-to-end ID'),
          value: receipt.references.pixEndToEndId,
        }
      : null,
    receipt.references.brebId
      ? {
          key: 'breb',
          label: t('activity.reference.breb', 'BRE-B reference'),
          value: receipt.references.brebId,
        }
      : null,
    receipt.references.providerId
      ? {
          key: 'provider',
          label: t('activity.reference.provider', 'Provider reference'),
          value: receipt.references.providerId,
        }
      : null,
    receipt.references.onChainId
      ? {
          key: 'on-chain',
          label: t('activity.reference.on_chain', 'On-chain transaction'),
          value: receipt.references.onChainId,
        }
      : null,
    receipt.references.refundOnChainId
      ? {
          key: 'refund',
          label: t('activity.reference.refund', 'Refund transaction'),
          value: receipt.references.refundOnChainId,
        }
      : null,
  ]
  return rows.filter((row): row is ActivityReferenceRow => row !== null)
}
