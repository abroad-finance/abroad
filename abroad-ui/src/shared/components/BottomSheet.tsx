import { useTranslate } from '@tolgee/react'
import { animate, motion, useMotionValue } from 'framer-motion'
import React, { useEffect, useRef } from 'react'

import { cn } from '../../shared/utils'

export interface BottomSheetProps {
  children: React.ReactNode
  className?: string
  onClose: () => void
}

/**
 * Full-screen backdrop; panel slides up from bottom (max 85vh). Drag handle at top.
 * On mobile: drag down from scroll-top dismisses the sheet.
 * Clicking backdrop calls onClose.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({ children, className, onClose }) => {
  const { t } = useTranslate()
  const panelRef = useRef<HTMLDivElement>(null)
  const y = useMotionValue(0)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const el = panelRef.current
    if (!el) return

    const s = {
      dragging: false, lastT: 0, lastY: 0, scrollTopAtStart: 0, startY: 0,
    }

    function onTouchStart(e: TouchEvent) {
      s.startY = e.touches[0].clientY
      s.scrollTopAtStart = el.scrollTop
      s.dragging = false
      s.lastY = s.startY
      s.lastT = Date.now()
    }

    function onTouchMove(e: TouchEvent) {
      const currentY = e.touches[0].clientY
      const deltaY = currentY - s.startY

      if (s.dragging) {
        y.set(Math.max(0, deltaY))
        s.lastY = currentY
        s.lastT = Date.now()
        e.preventDefault()
        return
      }

      if (deltaY > 6 && s.scrollTopAtStart === 0) {
        s.dragging = true
        y.set(Math.max(0, deltaY))
        s.lastY = currentY
        s.lastT = Date.now()
        e.preventDefault()
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!s.dragging) return
      s.dragging = false

      const endY = e.changedTouches[0].clientY
      const offset = endY - s.startY
      const dt = Date.now() - s.lastT
      const velocity = dt > 0 && dt < 150 ? (s.lastY - s.startY) / dt : 0

      if (offset > 80 || velocity > 0.5) {
        onCloseRef.current()
      }
      else {
        animate(y, 0, { damping: 40, stiffness: 400, type: 'spring' })
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [y])

  return (
    <div
      aria-label={t('bottom_sheet.close', 'Close sheet')}
      className={cn(
        'fixed inset-0 z-[300] flex items-end md:items-center justify-center',
        'bg-black/35 backdrop-blur-[8px]',
        'transition-[visibility,opacity] duration-[0.4s] ease-[cubic-bezier(0.16,1,0.3,1)]',
      )}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClose()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <motion.div
        className={cn(
          'w-full max-w-[520px] max-h-[85vh] overflow-y-auto rounded-t-[24px] md:rounded-[24px]',
          'bg-[var(--ab-bg-card)] shadow-[0_-12px_40px_rgba(0,0,0,0.08)]',
          'border-0 p-0 m-0',
          className,
        )}
        onClick={e => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}
        ref={panelRef}
        role="dialog"
        style={{ y }}
      >
        <div
          aria-hidden
          className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-[var(--ab-border)] md:hidden"
        />
        {children}
      </motion.div>
    </div>
  )
}
