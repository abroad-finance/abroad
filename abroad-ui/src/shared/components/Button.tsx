import { Loader } from 'lucide-react'
import React from 'react'

import { cn } from '../utils'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
}

export function Button({
  children,
  className = '',
  disabled,
  loading = false,
  ...props
}: ButtonProps) {
  const isDisabled = Boolean(disabled || loading)
  return (
    <button
      aria-busy={loading || undefined}
      className={cn(
        'text-base font-semibold rounded-2xl px-6 py-4 transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
        isDisabled ? 'bg-ab-separator text-ab-text-muted' : 'bg-ab-btn text-ab-btn-text',
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {loading && <Loader aria-hidden className="h-5 w-5 animate-spin" />}
      <span className={loading ? 'opacity-80' : undefined}>{children}</span>
    </button>
  )
}
