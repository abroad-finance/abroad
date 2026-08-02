import type { MouseEvent as ReactMouseEvent } from 'react'

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { OpsDialog } from './OpsDialog'

type OpsUnsavedChangesGuardProps = {
  active: boolean
  message?: string
}

type PendingNavigation = {
  href: string
  label: string
}

/**
 * Guards link navigation with an accessible in-product dialog and protects
 * browser refresh/close with the platform beforeunload contract. Configuration
 * pages still own programmatic selection changes so they can preserve drafts.
 */
export const OpsUnsavedChangesGuard = ({ active, message = 'Your unsaved editor changes will be discarded.' }: OpsUnsavedChangesGuardProps) => {
  const navigate = useNavigate()
  const [pending, setPending] = useState<null | PendingNavigation>(null)

  useEffect(() => {
    if (!active) return undefined
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [active])

  useEffect(() => {
    if (!active) return undefined
    const handleClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!target || target.target === '_blank' || target.hasAttribute('download')) return
      const destination = new URL(target.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const href = `${destination.pathname}${destination.search}${destination.hash}`
      if (href === current) return
      event.preventDefault()
      event.stopPropagation()
      setPending({ href, label: target.textContent?.trim() || 'the selected page' })
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [active])

  const discard = useCallback((event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    if (!pending) return
    const destination = pending.href
    setPending(null)
    navigate(destination)
  }, [navigate, pending])

  if (!pending) return null
  return (
    <OpsDialog
      description={message}
      eyebrow="Unsaved configuration"
      onClose={() => setPending(null)}
      title={`Leave for ${pending.label}?`}
    >
      <p className="text-sm leading-6 text-ops-muted">
        Create the review draft before leaving if these changes should be retained.
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="ops-btn-neutral" onClick={() => setPending(null)} type="button">Keep editing</button>
        <button className="ops-btn-danger" onClick={discard} type="button">Discard and leave</button>
      </div>
    </OpsDialog>
  )
}
