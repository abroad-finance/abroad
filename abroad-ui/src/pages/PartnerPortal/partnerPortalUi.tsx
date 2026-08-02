import { Check, Copy, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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

export const OneTimeSecretDialog = ({
  description,
  label,
  onClose,
  secret,
}: {
  description: string
  label: string
  onClose: () => void
  secret: string
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const dialog = dialogRef.current
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const focusableElements = (): HTMLElement[] => (
      dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
            .filter(element => element.getAttribute('aria-hidden') !== 'true')
        : []
    )
    focusableElements()[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const elements = focusableElements()
      if (elements.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
      else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    dialog?.addEventListener('keydown', handleKeyDown)
    return () => {
      dialog?.removeEventListener('keydown', handleKeyDown)
      const restoreTarget = previouslyFocused?.isConnected
        && !previouslyFocused.matches(':disabled')
        ? previouslyFocused
        : previouslyFocused
            ?.closest('form, section, main')
            ?.querySelector<HTMLElement>(focusableSelector)
      restoreTarget?.focus()
    }
  }, [onClose])

  return (
    <div aria-describedby="one-time-secret-description" aria-labelledby="one-time-secret-title" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-partner-ink/45 p-4 backdrop-blur-sm sm:items-center" ref={dialogRef} role="dialog" tabIndex={-1}>
      <div className="w-full max-w-xl rounded-[1.5rem] border border-partner-border bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="partner-eyebrow">Shown once</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-partner-ink" id="one-time-secret-title">{label}</h2>
            <p className="mt-2 text-sm leading-6 text-partner-muted" id="one-time-secret-description">{description}</p>
          </div>
          <button aria-label={`Close ${label}`} className="partner-icon-button" onClick={onClose} type="button">
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 flex items-start gap-2 rounded-2xl border border-partner-border bg-partner-ledger p-4">
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-sm font-semibold text-partner-ink">{secret}</code>
          <CopyValueButton label={label} value={secret} />
        </div>
        <p className="mt-4 text-xs font-medium text-amber-800">Copy and store this securely before closing. Abroad cannot show it again.</p>
        <button className="partner-button-primary mt-6 w-full" onClick={onClose} type="button">I saved it</button>
      </div>
    </div>
  )
}

export const PartnerNotice = ({ children, tone = 'neutral' }: {
  children: React.ReactNode
  tone?: 'error' | 'neutral' | 'success' | 'warning'
}) => {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    neutral: 'border-partner-border bg-white text-partner-muted',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone]
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>
}

export const PartnerConfirmDialog = ({
  cancelLabel,
  confirmLabel,
  description,
  loading,
  onCancel,
  onConfirm,
  title,
}: {
  cancelLabel: string
  confirmLabel: string
  description: string
  loading?: boolean
  onCancel: () => void
  onConfirm: () => void
  title: string
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog
      aria-describedby="partner-confirm-description"
      aria-labelledby="partner-confirm-title"
      className="w-[calc(100%-2rem)] max-w-lg rounded-[1.5rem] border border-partner-border bg-white p-0 text-partner-ink shadow-2xl backdrop:bg-partner-ink/45 backdrop:backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault()
        if (!loading) onCancel()
      }}
      ref={dialogRef}
    >
      <div className="p-6 sm:p-8">
        <h2 className="text-2xl font-semibold tracking-[-0.025em]" id="partner-confirm-title">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-partner-muted" id="partner-confirm-description">{description}</p>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button className="partner-button-secondary" disabled={loading} onClick={onCancel} type="button">{cancelLabel}</button>
          <button className="min-h-11 rounded-xl bg-rose-700 px-5 text-sm font-semibold text-white transition hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
