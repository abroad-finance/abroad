import { Loader } from 'lucide-react'
import React from 'react'

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
  // Determine background style: disabled, gradient override, or default green
  const hasGradient = className.includes('bg-gradient-to-r')
  const defaultGradient = 'bg-gradient-to-r from-[#356E6A] to-[#73B9A3] hover:from-[#2a5956] hover:to-[#5fa88d] text-white'
  const isDisabled = Boolean(disabled || loading)
  const baseStyle = isDisabled
    ? 'bg-transparent !text-gray-400 cursor-not-allowed border border-[#356E6A]' // Ensure grey text when disabled
    : hasGradient
      ? 'text-gray-500'
      : defaultGradient
  return (
    <button
      aria-busy={loading || undefined}
      className={`${baseStyle} pointer-cursor text-xl font-medium rounded-xl px-4 py-2 transition inline-flex items-center justify-center gap-2 ${className}`}
      disabled={isDisabled}
      {...props}
    >
      {loading && <Loader aria-hidden className="h-5 w-5 animate-spin" />}
      <span className={loading ? 'opacity-80' : undefined}>{children}</span>
    </button>
  )
}
