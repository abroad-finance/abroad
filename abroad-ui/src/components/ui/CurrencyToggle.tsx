import { useTranslate } from '@tolgee/react'
import React from 'react'

import { CURRENCY_FLAG_URL } from '../../shared/constants'
import { cn } from '../../shared/utils'

export type CurrencyOption = 'BRL' | 'COP'

export interface CurrencyToggleProps {
  className?: string
  /** Called when user selects a currency */
  onChange: (currency: CurrencyOption) => void
  /** Currently selected currency */
  value: CurrencyOption
}

export const CurrencyToggle: React.FC<CurrencyToggleProps> = ({ className, onChange, value }) => {
  const { t } = useTranslate()
  return (
    <fieldset
      className={cn(
        'grid w-full grid-cols-2 items-stretch gap-1 rounded-xl bg-[var(--ab-bg-subtle)] p-1 shadow-sm sm:w-auto',
        'border-0 m-0',
        className,
      )}
    >
      <legend className="sr-only">{t('toggle.select_destination', 'Select destination, payment rail, and settlement currency')}</legend>
      <button
        aria-pressed={value === 'COP'}
        className={cn(
          'flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]',
          value === 'COP'
            ? 'border border-[var(--ab-border)] bg-[var(--ab-card)] shadow-sm'
            : 'hover:bg-[var(--ab-card)]/70',
        )}
        onClick={(e) => {
          e.stopPropagation()
          onChange('COP')
        }}
        type="button"
      >
        <img
          alt=""
          className="h-4 w-6 shrink-0 object-contain"
          src={CURRENCY_FLAG_URL.COP}
        />
        <span className="min-w-0 text-xs font-semibold leading-tight text-[var(--ab-text-secondary)] sm:text-sm">
          {t('toggle.colombia_breb_cop', 'Colombia · BRE-B · COP')}
        </span>
      </button>
      <button
        aria-pressed={value === 'BRL'}
        className={cn(
          'flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]',
          value === 'BRL'
            ? 'border border-[var(--ab-border)] bg-[var(--ab-card)] shadow-sm'
            : 'hover:bg-[var(--ab-card)]/70',
        )}
        onClick={(e) => {
          e.stopPropagation()
          onChange('BRL')
        }}
        type="button"
      >
        <img
          alt=""
          className="h-4 w-6 shrink-0 object-contain"
          src={CURRENCY_FLAG_URL.BRL}
        />
        <span className="min-w-0 text-xs font-semibold leading-tight text-[var(--ab-text-secondary)] sm:text-sm">
          {t('toggle.brazil_pix_brl', 'Brazil · Pix · BRL')}
        </span>
      </button>
    </fieldset>
  )
}
