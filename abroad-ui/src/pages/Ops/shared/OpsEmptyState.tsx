import type { ReactNode } from 'react'

import { cn } from '../../../shared/utils'

interface OpsEmptyStateProps {
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** Consistent dashed-border empty state for lists, tables and detail regions. */
export const OpsEmptyState = ({ action, children, className }: OpsEmptyStateProps) => (
  <div
    className={cn(
      'rounded-2xl border border-dashed border-ops-border bg-white/60 px-6 py-12 text-center text-sm text-ops-muted',
      className,
    )}
  >
    <div>{children}</div>
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
)
