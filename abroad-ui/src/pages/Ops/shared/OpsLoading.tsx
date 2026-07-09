import { Loader2 } from 'lucide-react'

import { cn } from '../../../shared/utils'

interface OpsLoadingProps {
  className?: string
  label?: string
}

/** Consistent inline loading indicator (spinner + copy) with polite live semantics. */
export const OpsLoading = ({ className, label = 'Loading…' }: OpsLoadingProps) => (
  <div
    aria-live="polite"
    className={cn('flex items-center gap-2 text-sm text-ops-muted', className)}
    role="status"
  >
    <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
    <span>{label}</span>
  </div>
)
