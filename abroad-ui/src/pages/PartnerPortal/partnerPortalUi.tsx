import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

import type { PartnerTransactionStatus } from '../../services/partnerPortal/partnerPortalTypes'

import { partnerStatusMeta } from './partnerPortalPresentation'

export const PartnerStatusBadge = ({ status }: { status: PartnerTransactionStatus }) => {
  const meta = partnerStatusMeta[status]
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.badgeClass}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  )
}

export const CopyValueButton = ({ label, value }: { label: string, value: string }) => {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    }
    catch {
      setCopied(false)
    }
  }

  return (
    <button
      aria-label={`${copied ? 'Copied' : 'Copy'} ${label}`}
      className="partner-icon-button"
      onClick={() => void copy()}
      title={`${copied ? 'Copied' : 'Copy'} ${label}`}
      type="button"
    >
      {copied
        ? <Check aria-hidden className="h-4 w-4" />
        : <Copy aria-hidden className="h-4 w-4" />}
    </button>
  )
}
