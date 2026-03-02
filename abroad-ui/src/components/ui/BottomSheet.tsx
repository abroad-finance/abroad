import React from 'react'

import { cn } from '../../shared/utils'

export interface BottomSheetProps {
  children: React.ReactNode
  className?: string
  onClose: () => void
}

/**
 * Full-screen backdrop; panel slides up from bottom (max 85vh). Drag handle at top.
 * Clicking backdrop calls onClose.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  children,
  className,
  onClose,
}) => (
  <div
    className={cn(
      'fixed inset-0 z-[300] flex items-end justify-center',
      'bg-black/35 backdrop-blur-[8px]',
      'transition-[visibility,opacity] duration-[0.4s] ease-[cubic-bezier(0.16,1,0.3,1)]',
    )}
    role="button"
    tabIndex={0}
    onClick={onClose}
    onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
  >
    <dialog
      open
      role="dialog"
      className={cn(
        'w-full max-w-[520px] max-h-[85vh] overflow-y-auto rounded-t-[24px]',
        'bg-[var(--ab-bg-card)] shadow-[0_-12px_40px_rgba(0,0,0,0.08)]',
        'transition-transform duration-[0.4s] ease-[cubic-bezier(0.16,1,0.3,1)]',
        'border-0 p-0 m-0',
        className,
      )}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      <div
        className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-[var(--ab-border)]"
        aria-hidden
      />
      {children}
    </dialog>
  </div>
)
