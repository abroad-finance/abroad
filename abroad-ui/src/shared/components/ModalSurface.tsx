import React, {
  type MouseEvent,
  type RefObject,
  useEffect,
  useRef,
} from 'react'

import { cn } from '../utils'

export interface ModalSurfaceProps {
  children: React.ReactNode
  className?: string
  descriptionId?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  onClose: () => void
  open: boolean
  titleId: string
  variant?: 'default' | 'fullscreen'
}

/**
 * Shared modal boundary. Native `showModal` provides browser-owned focus
 * containment and makes the rest of the document inert. We additionally
 * restore the opener and provide a non-modal test/legacy fallback.
 */
export const ModalSurface = ({
  children,
  className,
  descriptionId,
  initialFocusRef,
  onClose,
  open,
  titleId,
  variant = 'default',
}: Readonly<ModalSurfaceProps>): null | React.JSX.Element => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !open) {
      return
    }

    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal()
    }
    else {
      dialog.setAttribute('open', '')
    }
    document.body.classList.add('overflow-hidden')

    const initialFocus = initialFocusRef?.current
      ?? dialog.querySelector<HTMLElement>('[data-modal-initial-focus]')
    initialFocus?.focus()

    return () => {
      document.body.classList.remove('overflow-hidden')
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      openerRef.current?.focus()
      openerRef.current = null
    }
  }, [initialFocusRef, open])

  if (!open) return null

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className={cn(
        'fixed inset-0 z-[1000] overflow-visible border-0 bg-transparent p-0 text-[var(--ab-text)] backdrop:bg-black/45 backdrop:backdrop-blur-sm',
        variant === 'fullscreen'
          ? 'm-0 h-dvh max-h-none w-screen max-w-none'
          : 'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-max',
        className,
      )}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={handleBackdropClick}
      ref={dialogRef}
    >
      {children}
    </dialog>
  )
}
