import { ChevronDown } from 'lucide-react'
import React from 'react'
import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { TokenBadge } from '../../../shared/components/TokenBadge'

interface CurrencySelectorProps {
    currencyMenuOpen: boolean
    currencyMenuRef: React.RefObject<HTMLDivElement | null>
    selectCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
    targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
    toggleCurrencyMenu: () => void
}

export function CurrencySelector({
    currencyMenuOpen,
    currencyMenuRef,
    selectCurrency,
    targetCurrency,
    toggleCurrencyMenu,
}: CurrencySelectorProps) {
    return (
        <div className="relative ml-2 shrink-0" ref={currencyMenuRef}>
            <button
                aria-expanded={currencyMenuOpen}
                aria-haspopup="listbox"
                className="focus:outline-none cursor-pointer relative z-[1001]"
                onClick={toggleCurrencyMenu}
                type="button"
            >
                <TokenBadge
                    alt={`${targetCurrency} Flag`}
                    iconSrc={
                        targetCurrency === TargetCurrency.BRL
                            ? 'https://hatscripts.github.io/circle-flags/flags/br.svg'
                            : 'https://hatscripts.github.io/circle-flags/flags/co.svg'
                    }
                    suffix={
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${currencyMenuOpen ? 'rotate-180' : ''}`} />
                    }
                    symbol={targetCurrency}
                />
            </button>

            {currencyMenuOpen && (
                <div
                    className="absolute right-0 top-[calc(100%+8px)] z-[10000] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl ring-1 ring-black/10 p-1 space-y-0.5 w-full min-w-full"
                    role="listbox"
                >
                    <button
                        aria-selected={targetCurrency === TargetCurrency.COP}
                        className={`w-full text-left rounded-xl p-3 cursor-pointer transition-all active:scale-95 flex items-center gap-3 ${targetCurrency === TargetCurrency.COP ? 'bg-[#356E6A]/10 text-[#356E6A] font-bold' : 'hover:bg-black/5'
                            }`}
                        onClick={() => selectCurrency(TargetCurrency.COP)}
                        role="option"
                        type="button"
                    >
                        <TokenBadge
                            alt="Colombia flag"
                            iconSrc="https://hatscripts.github.io/circle-flags/flags/co.svg"
                            symbol="COP"
                            transparent
                        />
                    </button>
                    <button
                        aria-selected={targetCurrency === TargetCurrency.BRL}
                        className={`w-full text-left rounded-xl p-3 cursor-pointer transition-all active:scale-95 flex items-center gap-3 ${targetCurrency === TargetCurrency.BRL ? 'bg-[#356E6A]/10 text-[#356E6A] font-bold' : 'hover:bg-black/5'
                            }`}
                        onClick={() => selectCurrency(TargetCurrency.BRL)}
                        role="option"
                        type="button"
                    >
                        <TokenBadge
                            alt="Brazil flag"
                            iconSrc="https://hatscripts.github.io/circle-flags/flags/br.svg"
                            symbol="BRL"
                            transparent
                        />
                    </button>
                </div>
            )}
        </div>
    )
}
