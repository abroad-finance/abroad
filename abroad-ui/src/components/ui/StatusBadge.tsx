import React from 'react'

import { cn } from '../../shared/utils'

export type StatusBadgeVariant = 'completed' | 'expired' | 'pending'

export interface StatusBadgeProps {
  className?: string
  variant: StatusBadgeVariant
  children: React.ReactNode
}

const variantStyles: Record<StatusBadgeVariant, { bg: string, border: string, text: string }> = {
  completed: {
    bg: 'var(--ab-green-soft)',
    border: 'var(--ab-green-border)',
    text: 'var(--ab-green-dark)',
  },
  expired: {
    bg: '#FEF2F2',
    border: '#FECACA',
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
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  children,
  className,
  variant,
}) => {
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
