import type { ReactNode } from 'react'

import { cn } from '../../../shared/utils'

export type OpsBannerVariant = 'error' | 'info' | 'success' | 'warning'

const variantClass: Record<OpsBannerVariant, string> = {
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  info: 'border-sky-200 bg-sky-50 text-sky-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
}

interface OpsBannerProps {
  children: ReactNode
  className?: string
  variant: OpsBannerVariant
}

/** Inline status/alert banner with consistent padding and the right ARIA live semantics. */
export const OpsBanner = ({ children, className, variant }: OpsBannerProps) => (
  <div
    aria-live={variant === 'error' ? 'assertive' : 'polite'}
    className={cn('rounded-xl border px-4 py-3 text-sm', variantClass[variant], className)}
    role={variant === 'error' ? 'alert' : 'status'}
  >
    {children}
  </div>
)
