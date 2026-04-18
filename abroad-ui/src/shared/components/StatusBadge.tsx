import React from 'react'

import { cn } from '../../shared/utils'

export interface StatusBadgeProps {
  children: React.ReactNode
  className?: string
  variant: StatusBadgeVariant
}

export type StatusBadgeVariant = 'completed' | 'expired' | 'pending'

const variantStyles: Record<StatusBadgeVariant, { bg: string, border: string, text: string }> = {
  completed: {
    bg: 'var(--ab-green-soft)',
    border: 'var(--ab-green-border)',
    text: 'var(--ab-green-dark)',
  },
  expired: {
    bg: 'var(--ab-red-soft)',
    border: 'var(--ab-red-border)',
    text: 'var(--ab-red)',
  },
  pending: {
    bg: 'var(--ab-bg-muted)',
    border: 'var(--ab-border)',
    text: 'var(--ab-text-secondary)',
  },
}

/**
 * Pill badge for transaction status: completed (green), expired (red), pending (muted).
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ children, className, variant }) => {
  const styles = variantStyles[variant]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold',
        className,
      )}
      style={{
        background: styles.bg,
        borderColor: styles.border,
        color: styles.text,
      }}
    >
      {children}
    </span>
  )
}
