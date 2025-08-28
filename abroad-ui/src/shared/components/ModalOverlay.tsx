import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'

interface ModalOverlayProps {
  /** When true, content is aligned to end on desktop the way WebSwap did */
  alignEndOnDesktop?: boolean
  /** Optional classes applied to the backdrop */
  backdropClassName?: string
  /** Modal content */
  children: React.ReactNode
  /** Optional classes applied to the container wrapping children */
  containerClassName?: string
  /** Close handler (backdrop click) */
  onClose: () => void
  /** Control visibility */
  open: boolean
  /** Optional z-index override (default 999) */
  zIndexClassName?: string
}

/**
 * Generic animated modal overlay backdrop. Closes when clicking outside its inner content.
 */
export const ModalOverlay: React.FC<ModalOverlayProps> = ({
  alignEndOnDesktop = true,
  backdropClassName = 'bg-black/60 backdrop-blur-sm',
  children,
  containerClassName = '',
  onClose,
  open,
  zIndexClassName = 'z-[999]',
}) => {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          animate={{ opacity: 1 }}
          className={`fixed inset-0 ${backdropClassName} ${zIndexClassName} flex items-center justify-center ${alignEndOnDesktop ? 'md:justify-end' : ''} p-4 md:pr-8`}
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onClick={onClose}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <div className={containerClassName} onClick={e => e.stopPropagation()}>
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
