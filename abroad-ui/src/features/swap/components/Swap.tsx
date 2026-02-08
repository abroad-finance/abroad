import { useTranslate } from '@tolgee/react'
import {
  ArrowLeftRight,
  ChevronDown,
  ArrowDownUp,
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
import { ASSET_URLS } from '../../../shared/constants'

const CRYPTO_ICONS: Record<string, string> = {
  USDC: ASSET_URLS.USDC_TOKEN_ICON,
  USDT: ASSET_URLS.USDT_TOKEN_ICON,
}

const CHAIN_ICON_PREFIXES: Array<[string, string]> = [
  ['Stellar', ASSET_URLS.STELLAR_CHAIN_ICON],
  ['Solana', ASSET_URLS.SOLANA_CHAIN_ICON],
  ['Celo', ASSET_URLS.CELO_CHAIN_ICON],
]

const getChainIcon = (label: string): string | undefined =>
  CHAIN_ICON_PREFIXES.find(([prefix]) => label.startsWith(prefix))?.[1]

export interface SwapProps {
  assetMenuOpen: boolean
  assetMenuRef: React.RefObject<HTMLDivElement | null>
  assetOptions: Array<{ key: string, label: string }>
  chainMenuOpen: boolean
  chainMenuRef: React.RefObject<HTMLDivElement | null>
  chainOptions: Array<{ key: string, label: string }>
  continueDisabled: boolean
  currencyMenuOpen: boolean
  currencyMenuRef: React.RefObject<HTMLDivElement | null>
  exchangeRateDisplay: string // e.g. '-', 'R$5,43'
  hasInsufficientFunds?: boolean
  isAboveMaximum: boolean
  isAuthenticated: boolean
  isBelowMinimum: boolean
  loadingBalance?: boolean
  loadingSource: boolean
  loadingTarget: boolean
  onPrimaryAction: () => void
  onSourceChange: (value: string) => void
  onTargetChange: (value: string) => void
  openQr: () => void
  selectAssetOption: (key: string) => void
  selectChain: (key: string) => void
  selectCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  selectedAssetLabel: string
  selectedChainLabel: string
  sourceAmount: string
  sourceSymbol: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  targetSymbol: string
  textColor?: string
  toggleAssetMenu: () => void
  toggleChainMenu: () => void
  toggleCurrencyMenu: () => void
  transferFeeDisplay: string // e.g. 'R$0,00'
  usdcBalance?: string
}

export default function Swap({
  assetMenuOpen,
  assetMenuRef,
  assetOptions,
  chainMenuOpen,
  chainMenuRef,
  chainOptions,
  continueDisabled,
  currencyMenuOpen,
  currencyMenuRef,
  exchangeRateDisplay,
  hasInsufficientFunds,
  isAboveMaximum,
  isAuthenticated,
  isBelowMinimum,
  loadingBalance,
  loadingSource,
  loadingTarget,
  onPrimaryAction,
  onSourceChange,
  onTargetChange,
  openQr,
  selectAssetOption,
  selectChain,
  selectCurrency,
  selectedAssetLabel,
  selectedChainLabel,
  sourceAmount,
  sourceSymbol,
  targetAmount,
  targetCurrency,
  targetSymbol,
  toggleAssetMenu,
  toggleChainMenu,
  toggleCurrencyMenu,
  transferFeeDisplay,
  usdcBalance,
}: SwapProps): React.JSX.Element {
  const { t } = useTranslate()

  // Handler to scroll input into view on mobile focus
  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 300)
  }, [])

  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col text-abroad-dark md:text-white">
      <div
        className="w-[98%] max-w-md min-h-[60vh] bg-white/30 backdrop-blur-2xl rounded-[2rem] p-5 md:p-8 flex flex-col items-center justify-center space-y-2 lg:space-y-4 shadow-[0_8px_32px_rgba(53,110,106,0.08)] border border-white/40"
        id="background-container"
      >
        {/* Title + QR button */}
        <div className="flex items-center justify-between w-full pt-2">
          <div className="text-[1.8rem] md:text-[2rem] font-bold leading-tight tracking-tight">
            <span>
              {t('swap.title', 'Pay or send')}
              {' '}
              <span className="opacity-60">
                {targetCurrency === TargetCurrency.BRL
                  ? t('swap.to_country_br', 'to Brazil')
                  : t('swap.to_country_co', 'to Colombia')}
              </span>
            </span>
          </div>

          {targetCurrency === TargetCurrency.BRL && (
            <button
              aria-label={t('swap.scan_qr_aria', 'Escanear QR')}
              className="p-2 cursor-pointer bg-white/60 backdrop-blur-xl rounded-full hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40 transition shadow-sm shrink-0"
              onClick={openQr}
              type="button"
            >
              <ScanLine className="w-8 h-8" />
            </button>
          )}
        </div>

        {/* Chain selector + Exchange rate */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5 text-base md:text-lg font-medium opacity-80">
            <ArrowLeftRight className="w-4 h-4" />
            <span>
              1 {sourceSymbol} = <b>{exchangeRateDisplay}</b>
            </span>
          </div>

          <div className="relative shrink-0" ref={chainMenuRef}>
            <button
              aria-expanded={chainMenuOpen}
              aria-haspopup="listbox"
              className="focus:outline-none cursor-pointer"
              onClick={toggleChainMenu}
              type="button"
            >
              <TokenBadge
                iconSrc={getChainIcon(selectedChainLabel)}
                suffix={chainOptions.length > 1
                  ? <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${chainMenuOpen ? 'rotate-180' : ''}`} />
                  : undefined}
                symbol={selectedChainLabel}
              />
            </button>

            {chainMenuOpen && chainOptions.length > 1 && (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-[70] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl ring-1 ring-black/10 p-1 space-y-0.5 min-w-[160px]"
                role="listbox"
              >
                {chainOptions.map(option => (
                  <button
                    aria-selected={option.label === selectedChainLabel}
                    className={`cursor-pointer w-full text-left rounded-xl px-1 py-1 transition-all active:scale-95${option.label === selectedChainLabel ? ' bg-[#356E6A]/10' : ' hover:bg-black/5'}`}
                    key={option.key}
                    onClick={() => selectChain(option.key)}
                    role="option"
                    type="button"
                  >
                    <TokenBadge iconSrc={getChainIcon(option.label)} symbol={option.label} transparent />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SOURCE */}
        <div
          className={`relative z-20 w-full bg-white/50 backdrop-blur-xl rounded-3xl p-5 md:py-7 md:px-7 flex flex-col${hasInsufficientFunds ? ' ring-2 ring-red-500' : ''}`}
          id="source-amount"
        >
          <span className="text-xs md:text-sm opacity-60 font-medium mb-1">
            {t('swap.from_balance', 'De tu balance')}
          </span>
          <div className="flex items-center justify-between">
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="text-2xl md:text-3xl font-bold shrink-0 text-abroad-dark">
                {sourceSymbol}
              </span>
              {loadingSource
                ? (
                    <Loader className="animate-spin w-6 h-6" />
                  )
                : (
                    <input
                      className="w-full bg-transparent font-bold focus:outline-none text-2xl md:text-3xl text-abroad-dark"
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
            <div className="relative ml-2 shrink-0" ref={assetMenuRef}>
              <button
                aria-expanded={assetMenuOpen}
                aria-haspopup="listbox"
                className="focus:outline-none cursor-pointer"
                onClick={toggleAssetMenu}
                type="button"
              >
                <TokenBadge
                  iconSrc={CRYPTO_ICONS[selectedAssetLabel]}
                  suffix={assetOptions.length > 1
                    ? <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${assetMenuOpen ? 'rotate-180' : ''}`} />
                    : undefined}
                  symbol={selectedAssetLabel}
                />
              </button>

              {assetMenuOpen && assetOptions.length > 1 && (
                <div
                  className="absolute right-0 top-[calc(100%+8px)] z-[60] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl ring-1 ring-black/10 p-1 space-y-0.5 min-w-[160px]"
                  role="listbox"
                >
                  {assetOptions.map(option => (
                    <button
                      aria-selected={option.label === selectedAssetLabel}
                      className={`cursor-pointer w-full text-left rounded-xl px-1 py-1 transition-all active:scale-95${option.label === selectedAssetLabel ? ' bg-[#356E6A]/10' : ' hover:bg-black/5'}`}
                      key={option.key}
                      onClick={() => selectAssetOption(option.key)}
                      role="option"
                      type="button"
                    >
                      <TokenBadge iconSrc={CRYPTO_ICONS[option.label]} symbol={option.label} transparent />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {isAuthenticated && usdcBalance !== undefined && (
            <div className={`text-xs md:text-sm mt-1${hasInsufficientFunds ? ' text-red-500' : ' opacity-60'}`}>
              {loadingBalance
                ? <Loader className="inline animate-spin w-3 h-3" />
                : (
                    <>
                      {t('swap.balance', 'Balance:')}
                      {' '}
                      $
                      {usdcBalance}
                      {' '}
                      {selectedAssetLabel}
                    </>
                  )}
            </div>
          )}
        </div>

        {/* TARGET or Connect notice */}

        <div
          className={`relative w-full backdrop-blur-xl rounded-3xl p-5 md:py-7 md:px-7 flex flex-col transition-colors duration-300 ${currencyMenuOpen ? 'z-50' : 'z-10'} ${isBelowMinimum || isAboveMaximum
            ? 'bg-red-500/10 border border-red-500/30'
            : 'bg-white/50'
          }`}
          id="target-amount"
        >
          {/* chevrons */}
          <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 bg-white rounded-full grid place-items-center shadow-md border border-abroad-light/20 z-30">
            <ArrowDownUp className="w-5 h-5 text-abroad-dark" />
          </div>

          <span className="text-xs md:text-sm opacity-60 font-medium mb-1">
            {t('swap.you_pay', 'Pagarás')}
          </span>

          {/* input */}
          <div className="flex items-center justify-between">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-2xl md:text-3xl font-bold shrink-0 text-abroad-dark">
              {targetSymbol}
            </span>
            {loadingTarget
              ? (
                  <Loader className="animate-spin w-6 h-6" />
                )
              : (
                  <input
                    className="w-full bg-transparent font-bold focus:outline-none text-2xl md:text-3xl text-abroad-dark"
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
                  className={`w-full text-left rounded-xl p-3 cursor-pointer transition-all active:scale-95 flex items-center gap-3 ${targetCurrency === TargetCurrency.COP ? 'bg-[#356E6A]/10 text-[#356E6A] font-bold' : 'hover:bg-black/5'}`}
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
                  className={`w-full text-left rounded-xl p-3 cursor-pointer transition-all active:scale-95 flex items-center gap-3 ${targetCurrency === TargetCurrency.BRL ? 'bg-[#356E6A]/10 text-[#356E6A] font-bold' : 'hover:bg-black/5'}`}
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
        <div className="flex-1 flex items-center justify-center w-full pt-2">
          <div className="w-full" id="tx-info">
            <div className="flex flex-col space-y-3">
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
              {targetCurrency === TargetCurrency.COP && (
                <div
                  className={`flex items-center space-x-2 ${isAboveMaximum ? 'text-red-600 font-bold' : 'opacity-70'}`}
                  id="max-amount"
                >
                  <CircleDollarSign className="w-5 h-5" />
                  <span>
                    {t('swap.max_amount_cop', 'Máximo: $5.000.000 COP')}
                  </span>
                </div>
              )}
              <div className="flex items-center space-x-2" id="transfer-fee">
                <Landmark className="w-5 h-5" />
                <span>
                  {t('swap.transfer_cost', 'Costo de Transferencia:')}
                  {' '}
                  <b>{transferFeeDisplay}</b>
                </span>
              </div>
              <div className="flex items-center space-x-2" id="time">
                <Timer className="w-5 h-5" />
                <span>
                  {t('swap.time', 'Tiempo:')}
                  {' '}
                  <b>{t('swap.time_value', '10 - 30 segundos')}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Primary button (connect or continue) */}
      <Button
        className="mt-5 w-[98%] max-w-md py-5 cursor-pointer rounded-2xl"
        disabled={continueDisabled}
        onClick={onPrimaryAction}
      >
        {!isAuthenticated
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
  )
}
