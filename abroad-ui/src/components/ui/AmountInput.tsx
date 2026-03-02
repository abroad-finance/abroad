import React, { useCallback, useRef } from 'react'

import { cn } from '../../shared/utils'

export type InputMode = 'local' | 'usdc'

export interface AmountInputProps {
  /** Currency code (COP, BRL) */
  currency: string
  /** Current input mode: which amount is shown in the big input */
  inputMode: InputMode
  /** Local (target) amount string, e.g. "14,350" or "23.80" */
  localValue: string
  /** Called when user changes the main input (local or USDC depending on mode) */
  onLocalChange: (value: string) => void
  onModeSwitch: () => void
  onUsdcChange: (value: string) => void
  /** Placeholder for local input (e.g. "14,350" for COP) */
  placeholderLocal: string
  /** Token label (e.g. USDC) */
  tokenLabel: string
  /** USDC (source) amount string */
  usdcValue: string
  /** Symbol for local currency ($ or R$) */
  symbol: string
  /** Converted value to show in the secondary pill (opposite of main input) */
  secondaryDisplay: string
  /** Loading state for the main input (e.g. fetching quote) */
  loading?: boolean
  /** Input id for a11y */
  id?: string
  className?: string
}

/**
 * Dual-mode amount input: big primary (local or USDC) and small secondary pill with "switch".
 * Used for manual payment screen with local-currency-first UX.
 */
export function AmountInput({
  currency,
  inputMode,
  localValue,
  onLocalChange,
  onModeSwitch,
  onUsdcChange,
  placeholderLocal,
  secondaryDisplay,
  tokenLabel,
  usdcValue,
  symbol,
  loading = false,
  id = 'amount-input',
  className,
}: AmountInputProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
  }, [])

  const isLocal = inputMode === 'local'

  const sanitizeLocal = (raw: string) => raw.replace(/[^0-9.,]/g, '')
  const sanitizeUsdc = (raw: string) => {
    const v = raw.replace(/[^0-9.]/g, '')
    const parts = v.split('.')
    if (parts.length > 2) return parts[0] + '.' + parts.slice(1).join('')
    return v
  }

  const inputContent = (() => {
    if (loading) {
      return (
        <div className="flex h-[52px] items-center justify-center text-[var(--ab-text-muted)]">
          <span className="inline-block h-6 w-6 animate-[ab-spin_0.8s_linear_infinite] rounded-full border-2 border-[var(--ab-border)] border-t-[var(--ab-green)]" />
        </div>
      )
    }
    if (isLocal) {
      return (
        <>
          <div className="mb-1 flex items-center justify-center gap-1">
            <span className="text-[42px] font-extrabold tracking-[-1.5px] text-[var(--ab-text)]">
              {symbol}
            </span>
            <input
              ref={inputRef}
              aria-label={`Amount in ${currency}`}
              className="min-w-[4ch] max-w-[24ch] bg-transparent text-[42px] font-extrabold tracking-[-1.5px] text-[var(--ab-text)] outline-none caret-[var(--ab-green)]"
              id={id}
              inputMode="decimal"
              onChange={e => onLocalChange(sanitizeLocal(e.target.value))}
              onFocus={handleFocus}
              placeholder={placeholderLocal}
              style={{ width: `${Math.max(5, (localValue || placeholderLocal).length + 1)}ch` }}
              type="text"
              value={localValue}
            />
            <span className="text-base font-bold text-[var(--ab-text-muted)]">{currency}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ab-bg-muted)] px-4 py-1.5">
            <span className="text-[13px] text-[var(--ab-text-secondary)]">≈</span>
            <span className="text-[13px] font-bold text-[var(--ab-text)]">
              ${usdcValue} {tokenLabel}
            </span>
            <button
              className="text-[11px] font-semibold text-[var(--ab-green)] underline"
              onClick={onModeSwitch}
              type="button"
            >
              switch
            </button>
          </div>
        </>
      )
    }
    return (
      <>
        <div className="mb-1 flex items-center justify-center gap-1">
          <span className="text-[42px] font-extrabold tracking-[-1.5px] text-[var(--ab-text)]">
            $
          </span>
          <input
            ref={inputRef}
            aria-label={`Amount in ${tokenLabel}`}
            className="min-w-[4ch] max-w-[20ch] bg-transparent text-[42px] font-extrabold tracking-[-1.5px] text-[var(--ab-text)] outline-none caret-[var(--ab-green)]"
            id={id}
            inputMode="decimal"
            onChange={e => onUsdcChange(sanitizeUsdc(e.target.value))}
            onFocus={handleFocus}
            placeholder="0.00"
            style={{ width: `${Math.max(4, (usdcValue || '0.00').length + 1)}ch` }}
            type="text"
            value={usdcValue}
          />
          <span className="text-base font-bold text-[var(--ab-green)]">{tokenLabel}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ab-bg-muted)] px-4 py-1.5">
          <span className="text-[13px] text-[var(--ab-text-secondary)]">{secondaryDisplay}</span>
          <button
            className="text-[11px] font-semibold text-[var(--ab-green)] underline"
            onClick={onModeSwitch}
            type="button"
          >
            switch
          </button>
        </div>
      </>
    )
  })()

  return (
    <div className={cn('text-center', className)}>
      {inputContent}
    </div>
  )
}
