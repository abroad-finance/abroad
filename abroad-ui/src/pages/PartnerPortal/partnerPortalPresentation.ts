import type { PartnerTransactionStatus } from '../../services/partnerPortal/partnerPortalTypes'

export type PartnerStatusMeta = {
  badgeClass: string
  dotClass: string
  explanation: string
  label: string
  spectrumClass: string
}

export const partnerStatusMeta: Record<PartnerTransactionStatus, PartnerStatusMeta> = {
  AWAITING_PAYMENT: {
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
    dotClass: 'bg-amber-500',
    explanation: 'Waiting for the blockchain payment to be detected.',
    label: 'Awaiting payment',
    spectrumClass: 'bg-amber-400',
  },
  PAYMENT_COMPLETED: {
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dotClass: 'bg-emerald-500',
    explanation: 'The payout completed successfully.',
    label: 'Completed',
    spectrumClass: 'bg-emerald-500',
  },
  PAYMENT_EXPIRED: {
    badgeClass: 'border-slate-200 bg-slate-50 text-slate-700',
    dotClass: 'bg-slate-400',
    explanation: 'The payment window ended before funds were confirmed.',
    label: 'Expired',
    spectrumClass: 'bg-slate-400',
  },
  PAYMENT_FAILED: {
    badgeClass: 'border-rose-200 bg-rose-50 text-rose-800',
    dotClass: 'bg-rose-500',
    explanation: 'The transaction could not complete. Contact Abroad support with the transaction ID.',
    label: 'Failed',
    spectrumClass: 'bg-rose-500',
  },
  PROCESSING_PAYMENT: {
    badgeClass: 'border-sky-200 bg-sky-50 text-sky-800',
    dotClass: 'bg-sky-500',
    explanation: 'Funds were detected and the payout is being processed.',
    label: 'Processing',
    spectrumClass: 'bg-sky-500',
  },
  WRONG_AMOUNT: {
    badgeClass: 'border-orange-200 bg-orange-50 text-orange-800',
    dotClass: 'bg-orange-500',
    explanation: 'The received amount did not match the quoted amount. Contact Abroad support with the transaction ID.',
    label: 'Needs attention',
    spectrumClass: 'bg-orange-500',
  },
}

export const formatPartnerAmount = (amount: number, currency: string): string => {
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 6,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount)
  return `${formatted} ${currency}`
}

export const formatPartnerDateTime = (value: string): string => (
  new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(new Date(value))
)

export const shortTransactionId = (transactionId: string): string => (
  `#${transactionId.slice(0, 8)}`
)

export const spectrumWeightClass = (count: number, maximum: number): string => {
  if (count <= 0) return 'flex-[0.15]'
  const ratio = count / Math.max(1, maximum)
  if (ratio < 0.25) return 'flex-[0.35]'
  if (ratio < 0.5) return 'flex-[0.7]'
  if (ratio < 0.75) return 'flex-1'
  return 'flex-[1.35]'
}
