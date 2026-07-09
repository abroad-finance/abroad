import type { ReactNode } from 'react'

import { cn } from '../../../shared/utils'

interface OpsFieldProps {
  children: ReactNode
  className?: string
  error?: ReactNode
  hint?: ReactNode
  label: ReactNode
}

/**
 * Labeled form field. Uses an implicit `<label>` wrapper so the caption is always
 * associated with its control (no orphan `<label className="ops-label">` + bare input),
 * giving screen readers and click-to-focus for free. Wrap a single input/select.
 *
 * Hint/error live OUTSIDE the `<label>` so they don't leak into the control's
 * accessible name (the label's text stays exactly the field caption).
 */
export const OpsField = ({
  children,
  className,
  error,
  hint,
  label,
}: OpsFieldProps) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <label className="flex flex-col gap-2">
      <span className="ops-label">{label}</span>
      {children}
    </label>
    {hint && <span className="text-xs text-ops-muted">{hint}</span>}
    {error && <span className="text-xs text-rose-700">{error}</span>}
  </div>
)
