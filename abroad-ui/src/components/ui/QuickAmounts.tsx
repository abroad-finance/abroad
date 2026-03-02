import React from 'react'

import { cn } from '../../shared/utils'

export interface QuickAmountsProps {
  amounts: string[]
  onSelect: (value: string) => void
  selectedValue: string
  symbol: string
  className?: string
}

/**
 * Preset amount buttons (e.g. $5,000 / $10,000 for COP or R$10 / R$25 for BRL).
 * Clicking one sets local amount and typically resets input mode to local.
 */
export function QuickAmounts({
  amounts,
  onSelect,
  selectedValue,
  symbol,
  className,
}: Readonly<QuickAmountsProps>): React.JSX.Element {
  return (
    <div className={cn('mt-3.5 flex flex-wrap justify-center gap-1.5', className)}>
      {amounts.map((value) => {
        const isSelected = selectedValue === value
        return (
          <button
            className={cn(
              'rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition-colors',
              isSelected
                ? 'border-[var(--ab-green-border)] bg-[var(--ab-green-soft)] text-[var(--ab-green-dark)]'
                : 'border-transparent bg-[var(--ab-bg-muted)] text-[var(--ab-text-muted)]',
            )}
            key={value}
            onClick={() => onSelect(value)}
            type="button"
          >
            {symbol}
            {value}
          </button>
        )
      })}
    </div>
  )
}
