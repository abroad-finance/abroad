import { useTranslate } from '@tolgee/react'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronsDown,
  CircleDollarSign,
  Landmark,
  Loader,
  ScanLine,
  Timer,
  Wallet,
} from 'lucide-react'
import React, { useCallback } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { Button } from '../../../shared/components/Button'
import { TokenBadge } from '../../../shared/components/TokenBadge'

export interface SwapProps {
  continueDisabled: boolean
  currencyMenuOpen: boolean
  currencyMenuRef: React.RefObject<HTMLDivElement | null>
  exchangeRateDisplay: string // e.g. '-', 'R$5,43'
  isAuthenticated: boolean
  isBelowMinimum: boolean
  hasInsufficientFunds: boolean
  loadingBalance: boolean
  loadingSource: boolean
  loadingTarget: boolean
  onPrimaryAction: () => void
  onSourceChange: (value: string) => void
  onTargetChange: (value: string) => void
  openQr: () => void
  selectCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  targetSymbol: string
  textColor?: string
  toggleCurrencyMenu: () => void
  transferFeeDisplay: string // e.g. 'R$0,00'
  usdcBalance: string
  isWalletConnected: boolean
}

export default function Swap({
  continueDisabled,
  currencyMenuOpen,
  currencyMenuRef,
  exchangeRateDisplay,
  isAuthenticated,
  isBelowMinimum,
  hasInsufficientFunds,
  loadingBalance,
  loadingSource,
  loadingTarget,
  onPrimaryAction,
  onSourceChange,
  onTargetChange,
  openQr,
  selectCurrency,
  sourceAmount,
  targetAmount,
  targetCurrency,
  targetSymbol,
  toggleCurrencyMenu,
  transferFeeDisplay,
  usdcBalance,
  isWalletConnected,
}: SwapProps): React.JSX.Element {
  const { t } = useTranslate()

  // Handler to scroll input into view on mobile focus
  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    // Trigger scroll twice: once immediately and once after a delay
    // to ensure visibility after keyboard layout shifts.
    input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 300)
  }, [])

  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col text-abroad-dark md:text-white">
      <div
        className="w-[98%] max-w-md min-h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4"
        id="background-container"
      >
        {/* Title + Subtitle + Exchange Rate */}
        <div className="flex-1 flex items-start justify-between w-full pt-2">
          <div className="flex flex-col space-y-3">
            <div className="text-[1.6rem] md:text-[1.8rem] font-bold leading-[1.6]">
              <span>{t('swap.title', 'Paga o Transfiere')}</span>
            </div>
            {/* Exchange rate moved here with more spacing */}
            <div className="flex items-center gap-1.5 text-sm md:text-base opacity-80 mt-1 mb-2 md:mb-4">
              <ArrowLeftRight className="w-4 h-4" />
              <span>
                1 USDC = <b>{targetSymbol}{exchangeRateDisplay}</b>
              </span>
            </div>
          </div>

          {targetCurrency === TargetCurrency.BRL && (
            <button
              aria-label={t('swap.scan_qr_aria', 'Escanear QR')}
              className="p-2 cursor-pointer bg-white/60 backdrop-blur-xl rounded-full hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40 transition shadow-sm"
              onClick={openQr}
              type="button"
            >
              <ScanLine className="w-8 h-8" />
            </button>
          )}
        </div>

        {/* SOURCE */}
        <div
          className={`w-full backdrop-blur-xl rounded-2xl p-4 md:py-6 md:px-6 flex flex-col transition-colors duration-300 ${hasInsufficientFunds || isBelowMinimum
            ? 'bg-red-500/10 border border-red-500/30'
            : 'bg-white/60'
            }`}
          id="source-amount"
        >
          {/* Label - always visible */}
          <span className="text-xs md:text-sm opacity-70 mb-1">
            {t('swap.from_balance', 'De tu balance')}
          </span>
          <div className="flex items-center justify-between">
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="text-xl md:text-2xl font-bold shrink-0">$</span>
              {loadingSource
                ? (
                  <Loader className="animate-spin w-6 h-6" />
                )
                : (
                  <input
                    className="w-full bg-transparent font-bold focus:outline-none text-xl md:text-2xl"
                    inputMode="decimal"
                    onFocus={handleFocus}
                    onChange={e => onSourceChange(e.target.value)}
                    pattern="[0-9.]*"
                    placeholder="0.00"
                    type="text"
                    value={sourceAmount}
                  />
                )}
            </div>
            <TokenBadge
              alt="USDC Token Logo"
              iconSrc="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
              symbol="USDC"
            />
          </div>
          {/* Balance display */}
          {isWalletConnected && (
            <div className="flex items-center gap-1 mt-2">
              <Wallet className="w-3 h-3 opacity-60" />
              {loadingBalance
                ? <Loader className="animate-spin w-3 h-3" />
                : (
                  <span className={`text-[10px] md:text-xs ${hasInsufficientFunds ? 'text-red-600 font-semibold' : 'opacity-60'}`}>
                    {usdcBalance ? `${t('swap.balance_label', 'Balance:')} $${parseFloat(usdcBalance).toFixed(2)} USDC` : t('swap.no_balance', 'Sin saldo')}
                  </span>
                )}
            </div>
          )}
        </div>

        {/* TARGET or Connect notice */}

        <div
          className={`relative w-full backdrop-blur-xl rounded-2xl p-4 md:py-6 md:px-6 flex flex-col transition-colors duration-300 ${currencyMenuOpen ? 'z-50' : 'z-0'} ${isBelowMinimum
            ? 'bg-red-500/10 border border-red-500/30'
            : 'bg-white/60'
            }`}
          id="target-amount"
        >
          {/* chevrons */}
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-[#356E6A]/5 rounded-full grid place-items-center">
            <ChevronsDown className="w-4 h-4" color="#356E6A" />
          </div>

          {/* Label - always visible */}
          <span className="text-xs md:text-sm opacity-70 mb-1">
            {t('swap.will_pay', 'Pagarás')}
          </span>

          <div className="flex w-full items-center justify-between">
            {/* input */}
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="text-xl md:text-2xl font-bold shrink-0">
                {targetSymbol}
              </span>
              {loadingTarget
                ? (
                  <Loader className="animate-spin w-6 h-6" />
                )
                : (
                  <input
                    className="w-full bg-transparent font-bold focus:outline-none text-xl md:text-2xl"
                    inputMode="decimal"
                    onFocus={handleFocus}
                    onChange={e => onTargetChange(e.target.value)}
                    pattern="[0-9.,]*"
                    placeholder="0,00"
                    type="text"
                    value={targetAmount}
                  />
                )}
            </div>

            {/* currency selector */}
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
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 flex items-center justify-center w-full">
          <div className="w-full" id="tx-info">
            <div className="flex flex-col space-y-2">
              {(targetCurrency === TargetCurrency.COP || targetCurrency === TargetCurrency.BRL) && (
                <div
                  className={`flex items-center space-x-2 ${isBelowMinimum ? 'text-red-600 font-bold' : 'opacity-70'}`}
                  id="min-amount"
                >
                  <CircleDollarSign className="w-5 h-5" />
                  <span>
                    {targetCurrency === TargetCurrency.COP
                      ? t('swap.min_amount_cop', 'Mínimo: $5.000 COP')
                      : t('swap.min_amount_brl', 'Mínimo: R$1,00')}
                  </span>
                </div>
              )}
              <div className="flex items-center space-x-2" id="transfer-fee">
                <Landmark className="w-5 h-5" />
                <span>
                  {t('swap.transfer_cost', 'Costo de Transferencia:')}{' '}
                  <b>{transferFeeDisplay}</b>
                </span>
              </div>
              <div className="flex items-center space-x-2" id="time">
                <Timer className="w-5 h-5" />
                <span>
                  <b>{t('swap.immediate', 'Inmediato')}</b>
                  {targetCurrency === TargetCurrency.COP && (
                    <span className="opacity-70"> ({t('swap.breb_keys', 'Llaves Bre-B')})</span>
                  )}
                  {targetCurrency === TargetCurrency.BRL && (
                    <span className="opacity-70"> (Pix)</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Primary button (connect or continue) */}
        <Button
          className="mt-4 w-full py-4 cursor-pointer"
          disabled={continueDisabled}
          onClick={onPrimaryAction}
        >
          {(!isAuthenticated || !isWalletConnected)
            ? (
              <div className="flex items-center justify-center space-x-2">
                <Wallet className="w-5 h-5" />
                <span>{t('swap.connect_wallet', 'Conectar Billetera')}</span>
              </div>
            )
            : (
              t('swap.continue', 'Continuar')
            )}
        </Button>
      </div>
    </div >
  )
}
