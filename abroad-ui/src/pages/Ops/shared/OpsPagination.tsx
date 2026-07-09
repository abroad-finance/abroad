import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '../../../shared/utils'

interface OpsPaginationProps {
  className?: string
  loading?: boolean
  onChange: (page: number) => void
  page: number
  totalPages: number
}

const arrowClass
  = 'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-ops-border bg-white text-ops-text transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-ops-bg disabled:cursor-not-allowed disabled:opacity-40'

/** Prev / "Page X of Y" / Next control with accessible names on the icon-only buttons. */
export const OpsPagination = ({
  className,
  loading,
  onChange,
  page,
  totalPages,
}: OpsPaginationProps) => (
  <div className={cn('flex items-center gap-2', className)}>
    <button
      aria-label="Previous page"
      className={arrowClass}
      disabled={page <= 1 || loading}
      onClick={() => onChange(Math.max(1, page - 1))}
      type="button"
    >
      <ChevronLeft aria-hidden className="h-4 w-4" />
    </button>
    <div className="text-sm font-medium text-ops-text tabular-nums">
      Page
      {' '}
      {page}
      {' '}
      of
      {' '}
      {totalPages}
    </div>
    <button
      aria-label="Next page"
      className={arrowClass}
      disabled={page >= totalPages || loading}
      onClick={() => onChange(Math.min(totalPages, page + 1))}
      type="button"
    >
      <ChevronRight aria-hidden className="h-4 w-4" />
    </button>
  </div>
)
