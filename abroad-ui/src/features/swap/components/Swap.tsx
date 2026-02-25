import { useTranslate } from '@tolgee/react'
import {
  ArrowDownUp,
  ChevronRight,
  CircleDollarSign,
  Landmark,
  Loader,
  ScanLine,
  Timer,
  Wallet,
  X,
} from 'lucide-react'
import React, { useCallback } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { AB_STYLES, ASSET_URLS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'

/* ── Icon maps ── */

const CRYPTO_ICONS: Record<string, string> = {
  USDC: ASSET_URLS.USDC_TOKEN_ICON,
  USDT: ASSET_URLS.USDT_TOKEN_ICON,
}

const CHAIN_ICONS: Record<string, string> = {
  Celo: ASSET_URLS.CELO_CHAIN_ICON,
  Solana: ASSET_URLS.SOLANA_CHAIN_ICON,
  Stellar: ASSET_URLS.STELLAR_CHAIN_ICON,
}

const getChainIcon = (label: string): string | undefined =>
  Object.entries(CHAIN_ICONS).find(([prefix]) => label.startsWith(prefix))?.[1]

/* ── Props ── */

export interface SwapProps {
  // Optional menu/options (when driven by useSwap instead of useWebSwapController)
  assetMenuOpen?: boolean
  assetMenuRef?: React.RefObject<HTMLDivElement | null>
  assetOptions?: Array<{ key: string, label: string }>
  chainMenuOpen?: boolean
  chainMenuRef?: React.RefObject<HTMLDivElement | null>
  chainOptions?: Array<{ key: string, label: string }>
  continueDisabled: boolean
  currencyMenuOpen?: boolean
  currencyMenuRef?: React.RefObject<HTMLDivElement | null>
  exchangeRateDisplay: string
  hasInsufficientFunds?: boolean
  isAboveMaximum: boolean
  isAuthenticated: boolean
  isBelowMinimum: boolean
  loadingBalance?: boolean
  loadingSource: boolean
  loadingTarget: boolean
  onBalanceClick?: () => void
  onDisconnect?: () => void
  onOpenSourceModal: () => void
  onOpenTargetModal: () => void
  onPrimaryAction: () => void
  onSourceChange: (value: string) => void
  onTargetChange: (value: string) => void
  openQr?: () => void
  selectAssetOption?: (key: string) => void
  selectChain?: (key: string) => void
  selectCurrency?: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  selectedAssetLabel: string
  selectedChainLabel: string
  sourceAmount: string
  sourceSymbol: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  targetSymbol: string
  textColor?: string
  toggleAssetMenu?: () => void
  toggleChainMenu?: () => void
  toggleCurrencyMenu?: () => void
  transferFeeDisplay: string
  usdcBalance?: string
  walletAddress?: null | string
}

export default function Swap({
  continueDisabled,
  exchangeRateDisplay,
  hasInsufficientFunds,
  isAboveMaximum,
  isAuthenticated,
  isBelowMinimum,
  loadingBalance,
  loadingSource,
  loadingTarget,
  onBalanceClick,
  onDisconnect,
  onOpenSourceModal,
  onOpenTargetModal,
  onPrimaryAction,
  onSourceChange,
  onTargetChange,
  openQr,
  selectedAssetLabel,
  selectedChainLabel,
  sourceAmount,
  sourceSymbol,
  targetAmount,
  targetCurrency,
  transferFeeDisplay,
  usdcBalance,
  walletAddress,
}: SwapProps): React.JSX.Element {
  const { t } = useTranslate()

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
  }, [])

  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null

  const chainIcon = getChainIcon(selectedChainLabel)
  const assetIcon = CRYPTO_ICONS[selectedAssetLabel]

  return (
    <div className="flex flex-col w-full max-w-md mx-auto gap-3">
      {/* ── Card ── */}
      <div className={cn('rounded-2xl p-1', AB_STYLES.cardBg)}>
        {/* Source Section */}
        <div className="p-4 pb-3">
          {/* QR button for BRL */}
          {targetCurrency === TargetCurrency.BRL && openQr && (
            <div className="flex justify-end mb-2">
              <button
                aria-label="Escanear QR"
                className={cn('p-2 rounded-full cursor-pointer transition-colors', AB_STYLES.badgeBg)}
                onClick={openQr}
                type="button"
              >
                <ScanLine className={cn('w-5 h-5', AB_STYLES.text)} />
              </button>
            </div>
          )}

          {/* Amount + Token selector */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {loadingSource
                ? <Loader className={cn('animate-spin w-6 h-6', AB_STYLES.textMuted)} />
                : (
                    <input
                      className={cn('w-full bg-transparent font-semibold focus:outline-none text-3xl', hasInsufficientFunds ? 'text-ab-error' : AB_STYLES.text)}
                      inputMode="decimal"
                      onChange={e => onSourceChange(e.target.value)}
                      onFocus={handleFocus}
                      pattern="[0-9.]*"
                      placeholder="0.0"
                      type="text"
                      value={sourceAmount}
                    />
                  )}
            </div>

            {/* Token badge → opens source modal */}
            <button
              className={cn('shrink-0 flex items-center gap-2 rounded-full px-3 py-2 cursor-pointer transition-colors', AB_STYLES.badgeBg)}
              onClick={onOpenSourceModal}
              type="button"
            >
              {assetIcon && <img alt={selectedAssetLabel} className="w-6 h-6 rounded-full" src={assetIcon} />}
              {chainIcon && (
                <img
                  alt={selectedChainLabel}
                  className="w-4 h-4 rounded-full -ml-[12px] -mb-[15px] ring-2 ring-ab-modal-bg"
                  src={chainIcon}
                />
              )}
              <div className="text-left ml-1">
                <span className={cn('text-sm font-semibold', AB_STYLES.text)}>{selectedAssetLabel}</span>
                <span className={cn('text-[10px] block leading-tight', AB_STYLES.textMuted)}>
                  from
                  {' '}
                  {selectedChainLabel}
                </span>
              </div>
              <ChevronRight className={cn('w-4 h-4', AB_STYLES.textMuted)} />
            </button>
          </div>

          {/* Wallet address + Balance row (Allbridge-style) */}
          <div className="flex items-center justify-between mt-2">
            {isAuthenticated && truncatedAddress
              ? (
                  <div className={cn('flex items-center gap-2 rounded-full px-3 py-1.5', AB_STYLES.badgeBg)}>
                    {chainIcon && <img alt={selectedChainLabel} className="w-4 h-4 rounded-full" src={chainIcon} />}
                    <span className={cn('text-xs font-medium', AB_STYLES.text)}>{truncatedAddress}</span>
                    {onDisconnect && (
                      <button
                        aria-label="Disconnect wallet"
                        className={cn('cursor-pointer p-0.5 rounded-full transition-colors', AB_STYLES.textMuted)}
                        onClick={onDisconnect}
                        type="button"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              : (
                  <button
                    className={cn('text-sm font-medium cursor-pointer transition-colors', AB_STYLES.btnColor)}
                    onClick={onPrimaryAction}
                    type="button"
                  >
                    {t('swap.connect_wallet', 'Connect wallet')}
                  </button>
                )}

            {isAuthenticated && usdcBalance !== undefined && (
              <button
                aria-label={t('swap.use_max_balance', 'Use max balance')}
                className={cn('flex items-center gap-1.5 cursor-pointer transition-colors', hasInsufficientFunds ? 'text-ab-error' : AB_STYLES.textMuted)}
                onClick={onBalanceClick}
                type="button"
              >
                <Wallet className="w-3.5 h-3.5" />
                {assetIcon && <img alt={selectedAssetLabel} className="w-4 h-4 rounded-full" src={assetIcon} />}
                {loadingBalance
                  ? <Loader className="animate-spin w-3 h-3" />
                  : <span className="text-xs font-medium">{usdcBalance}</span>}
              </button>
            )}
          </div>
        </div>

        {/* ── Separator with swap button ── */}
        <div className="relative flex items-center justify-center h-0">
          <div className={cn('absolute w-full', AB_STYLES.borderTopSeparator)} />
          <div className={cn('relative z-10 w-9 h-9 rounded-full flex items-center justify-center shadow-sm bg-ab-card border border-ab-separator')}>
            <ArrowDownUp className={cn('w-4 h-4', AB_STYLES.textMuted)} />
          </div>
        </div>

        {/* Target Section */}
        <div className={`p-4 pt-3 ${isBelowMinimum || isAboveMaximum ? 'rounded-b-xl ring-1 ring-red-500/30' : ''}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {loadingTarget
                ? <Loader className={cn('animate-spin w-6 h-6', AB_STYLES.textMuted)} />
                : (
                    <input
                      className={cn('w-full bg-transparent font-semibold focus:outline-none text-3xl', (isBelowMinimum || isAboveMaximum) ? 'text-ab-error' : AB_STYLES.text)}
                      inputMode="decimal"
                      onChange={e => onTargetChange(e.target.value)}
                      onFocus={handleFocus}
                      pattern="[0-9.,]*"
                      placeholder="0.0"
                      type="text"
                      value={targetAmount}
                    />
                  )}
            </div>

            {/* Currency badge → opens target modal */}
            <button
              className={cn('shrink-0 flex items-center gap-2 rounded-full px-3 py-2 cursor-pointer transition-colors', AB_STYLES.badgeBg)}
              onClick={onOpenTargetModal}
              type="button"
            >
              <img
                alt={`${targetCurrency} flag`}
                className="w-6 h-6 rounded-full"
                src={
                  targetCurrency === TargetCurrency.BRL
                    ? 'https://hatscripts.github.io/circle-flags/flags/br.svg'
                    : 'https://hatscripts.github.io/circle-flags/flags/co.svg'
                }
              />
              <span className={cn('text-sm font-semibold', AB_STYLES.text)}>{targetCurrency}</span>
              <ChevronRight className={cn('w-4 h-4', AB_STYLES.textMuted)} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Info Section ── */}
      <div className={cn('rounded-2xl px-4 py-3 space-y-2 text-xs', AB_STYLES.cardBg, AB_STYLES.textSecondary)}>
        {/* Exchange rate */}
        <div className="flex items-center justify-between">
          <span>{t('swap.rate', 'Rate')}</span>
          <span className={cn('font-medium', AB_STYLES.text)}>
            1
            {' '}
            {sourceSymbol}
            {' '}
            =
            {' '}
            {exchangeRateDisplay}
          </span>
        </div>

        {/* Fee */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5" />
            <span>{t('swap.transfer_cost', 'Transfer fee')}</span>
          </div>
          <span className={cn('font-medium', AB_STYLES.text)}>{transferFeeDisplay}</span>
        </div>

        {/* Time */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5" />
            <span>{t('swap.time', 'Time')}</span>
          </div>
          <span className={cn('font-medium', AB_STYLES.text)}>~30s</span>
        </div>

        {/* Min/Max warnings */}
        {isBelowMinimum && (
          <div className="flex items-center gap-1.5 text-red-500 font-medium">
            <CircleDollarSign className="w-3.5 h-3.5" />
            <span>
              {targetCurrency === TargetCurrency.COP
                ? t('swap.min_amount_cop', 'Min: $5.000 COP')
                : t('swap.min_amount_brl', 'Min: R$1,00')}
            </span>
          </div>
        )}
        {isAboveMaximum && (
          <div className="flex items-center gap-1.5 text-red-500 font-medium">
            <CircleDollarSign className="w-3.5 h-3.5" />
            <span>{t('swap.max_amount_cop', 'Max: $5.000.000 COP')}</span>
          </div>
        )}
      </div>

      {/* ── Primary Action Button ── */}
      <button
        className={cn(
          'w-full py-4 rounded-2xl text-base font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
          continueDisabled ? 'bg-ab-separator text-ab-text-muted' : 'bg-ab-btn text-ab-btn-text',
        )}
        disabled={continueDisabled}
        onClick={onPrimaryAction}
        type="button"
      >
        {!isAuthenticated
          ? (
              <div className="flex items-center justify-center gap-2">
                <Wallet className="w-5 h-5" />
                <span>{t('swap.connect_wallet', 'Connect wallet')}</span>
              </div>
            )
          : t('swap.continue', 'Send')}
      </button>
    </div>
  )
}
