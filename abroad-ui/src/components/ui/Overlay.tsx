import React from 'react'

import { cn } from '../../shared/utils'

export interface OverlayProps {
  children: React.ReactNode
  className?: string
  onClose: () => void
}

/**
 * Full-screen backdrop with blur; content centered. Use for modals (e.g. ChainSelector).
 * Clicking backdrop calls onClose; click on children does not close.
 */
export const Overlay: React.FC<OverlayProps> = ({
  children,
  className,
  onClose,
}) => (
  <div
    className={cn(
      'fixed inset-0 z-[300] flex items-center justify-center p-5',
      'bg-black/35 backdrop-blur-[12px]',
      'transition-[visibility,opacity] duration-[0.4s] ease-[cubic-bezier(0.16,1,0.3,1)]',
      className,
    )}
    role="button"
    tabIndex={0}
    onClick={onClose}
    onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
  >
    <dialog open role="dialog" className="border-0 p-0 m-0 bg-transparent" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      {children}
    </dialog>
  </div>
)
