import type { ReactNode } from 'react'

import { cn } from '../../../shared/utils'
import { humanizeStatus } from './opsFormat'

/**
 * Semantic tone scale for status pills. The tone -> class mapping lives here ONCE,
 * replacing the ~8 duplicated `statusClasses` / `flowStatusClasses` / `resultClasses`
 * maps that were copy-pasted across the Ops pages. Each page maps its own domain enum
 * to a tone (a tiny record) and renders <OpsStatusBadge tone=… label=… />.
 */
export type OpsTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning'

const toneClass: Record<OpsTone, string> = {
  danger: 'bg-rose-100 text-rose-800 border-rose-200',
  info: 'bg-sky-100 text-sky-800 border-sky-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
}

export interface OpsStatusBadgeProps {
  children?: ReactNode
  className?: string
  /** Raw status string; humanized automatically when `children` is not provided. */
  label?: null | string
  tone: OpsTone
}

/** Pill badge for any Ops status. Pass `tone` + `label` (auto-humanized) or `children`. */
export const OpsStatusBadge = ({
  children,
  className,
  label,
  tone,
}: OpsStatusBadgeProps) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold',
      toneClass[tone],
      className,
    )}
  >
    {children ?? humanizeStatus(label)}
  </span>
)
