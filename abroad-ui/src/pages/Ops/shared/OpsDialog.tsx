import type {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from 'react'

import { X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../../shared/utils'

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

type OpsDialogProps = {
  children: ReactNode
  description?: ReactNode
  eyebrow?: string
  onClose: () => void
  size?: 'lg' | 'xl'
  title: string
}

const sizeClass: Record<NonNullable<OpsDialogProps['size']>, string> = {
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
}

export const OpsDialog = ({
  children,
  description,
  eyebrow,
  onClose,
  size = 'lg',
  title,
}: OpsDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const descriptionId = useId()
  const titleId = useId()

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    }
    else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={handleOverlayClick}
    >
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-3xl border border-ops-border bg-white shadow-2xl sm:rounded-3xl',
          sizeClass[size],
        )}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-ops-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {eyebrow && <div className="ops-eyebrow">{eyebrow}</div>}
            <h2 className="mt-1 break-words text-xl font-semibold text-ops-text" id={titleId}>{title}</h2>
            {description && <p className="mt-1 text-sm text-ops-muted" id={descriptionId}>{description}</p>}
          </div>
          <button aria-label="Close dialog" className="ops-icon-btn shrink-0" onClick={onClose} type="button">
            <X aria-hidden size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
