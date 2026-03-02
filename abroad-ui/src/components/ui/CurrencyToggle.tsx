import React from 'react'

import { cn } from '../../shared/utils'

const FLAG_URLS = {
  COP: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
  BRL: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
} as const

export type CurrencyOption = 'COP' | 'BRL'

export interface CurrencyToggleProps {
  /** Currently selected currency */
  value: CurrencyOption
  /** Called when user selects a currency */
  onChange: (currency: CurrencyOption) => void
  className?: string
}

/**
 * Toggle between COP and BRL – Figma 9:368
 * Segmented control with flags; selected option has white background.
 */
export const CurrencyToggle: React.FC<CurrencyToggleProps> = ({
  value,
  onChange,
  className,
}) => (
  <fieldset
    className={cn(
      'inline-flex items-stretch gap-0.5 rounded-[11px] bg-[#f3f4f6] p-1 shadow-[1px_1px_3.6px_0px_rgba(0,0,0,0.25)]',
      'border-0 m-0',
      className
    )}
  >
    <legend className="sr-only">Select currency</legend>
    <button
      aria-pressed={value === 'COP'}
      className={cn(
        'flex h-[26px] items-center justify-center rounded-lg px-3 py-1.5 transition-colors',
        value === 'COP'
          ? 'border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]'
          : 'hover:bg-white/50'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onChange('COP')
      }}
      type="button"
    >
      <img
        alt="Colombia"
        className="h-[13px] w-5 object-contain"
        src={FLAG_URLS.COP}
      />
    </button>
    <button
      aria-pressed={value === 'BRL'}
      className={cn(
        'flex h-[26px] items-center justify-center rounded-lg px-3 py-1.5 transition-colors',
        value === 'BRL'
          ? 'border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]'
          : 'hover:bg-white/50'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onChange('BRL')
      }}
      type="button"
    >
      <img
        alt="Brazil"
        className="h-[13px] w-5 object-contain"
        src={FLAG_URLS.BRL}
      />
    </button>
  </fieldset>
)
