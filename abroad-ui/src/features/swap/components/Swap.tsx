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
import { ASSET_URLS } from '../../../shared/constants'

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
  continueDisabled: boolean
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
  openQr?: () => void
  onSourceChange: (value: string) => void
  onTargetChange: (value: string) => void
  selectedAssetLabel: string
  selectedChainLabel: string
  sourceAmount: string
  sourceSymbol: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  targetSymbol: string
  transferFeeDisplay: string
  usdcBalance?: string
  walletAddress?: null | string
  // Optional menu/options (when driven by useSwap instead of useWebSwapController)
  assetMenuOpen?: boolean
  assetMenuRef?: React.RefObject<HTMLDivElement | null>
  assetOptions?: Array<{ key: string; label: string }>
  chainMenuOpen?: boolean
  chainMenuRef?: React.RefObject<HTMLDivElement | null>
  chainOptions?: Array<{ key: string; label: string }>
  currencyMenuOpen?: boolean
  currencyMenuRef?: React.RefObject<HTMLDivElement | null>
  selectAssetOption?: (key: string) => void
  selectChain?: (key: string) => void
  selectCurrency?: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  textColor?: string
  toggleAssetMenu?: () => void
  toggleChainMenu?: () => void
  toggleCurrencyMenu?: () => void
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
  openQr,
  onSourceChange,
  onTargetChange,
  selectedAssetLabel,
  selectedChainLabel,
  sourceAmount,
  sourceSymbol,
  targetAmount,
  targetCurrency,
  targetSymbol: _targetSymbol,
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
      <div
        className="rounded-2xl p-1"
        style={{
          background: 'var(--ab-card)',
          border: '1px solid var(--ab-card-border)',
        }}
      >
        {/* Source Section */}
        <div className="p-4 pb-3">
          {/* QR button for BRL */}
          {targetCurrency === TargetCurrency.BRL && openQr && (
            <div className="flex justify-end mb-2">
              <button
                aria-label="Escanear QR"
                className="p-2 rounded-full cursor-pointer transition-colors"
                onClick={openQr}
                style={{
                  background: 'var(--ab-badge-bg)',
                  border: '1px solid var(--ab-badge-border)',
                }}
                type="button"
              >
                <ScanLine className="w-5 h-5" style={{ color: 'var(--ab-text)' }} />
              </button>
            </div>
          )}

          {/* Amount + Token selector */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {loadingSource
                ? <Loader className="animate-spin w-6 h-6" style={{ color: 'var(--ab-text-muted)' }} />
                : (
                    <input
                      className="w-full bg-transparent font-semibold focus:outline-none text-3xl"
                      inputMode="decimal"
                      onChange={e => onSourceChange(e.target.value)}
                      onFocus={handleFocus}
                      pattern="[0-9.]*"
                      placeholder="0.0"
                      style={{ color: hasInsufficientFunds ? '#ef4444' : 'var(--ab-text)' }}
                      type="text"
                      value={sourceAmount}
                    />
                  )}
            </div>

            {/* Token badge → opens source modal */}
            <button
              className="shrink-0 flex items-center gap-2 rounded-full px-3 py-2 cursor-pointer transition-colors"
              onClick={onOpenSourceModal}
              style={{
                background: 'var(--ab-badge-bg)',
                border: '1px solid var(--ab-badge-border)',
              }}
              type="button"
            >
              {assetIcon && <img alt={selectedAssetLabel} className="w-6 h-6 rounded-full" src={assetIcon} />}
              {chainIcon && (
                <img
                  alt={selectedChainLabel}
                  className="w-4 h-4 rounded-full -ml-3 ring-2 ring-[var(--ab-modal-bg)]"
                  src={chainIcon}
                />
              )}
              <div className="text-left ml-1">
                <span className="text-sm font-semibold" style={{ color: 'var(--ab-text)' }}>
                  {selectedAssetLabel}
                </span>
                <span className="text-[10px] block leading-tight" style={{ color: 'var(--ab-text-muted)' }}>
                  from {selectedChainLabel}
                </span>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--ab-text-muted)' }} />
            </button>
          </div>

          {/* Wallet address + Balance row (Allbridge-style) */}
          <div className="flex items-center justify-between mt-2">
            {isAuthenticated && truncatedAddress
              ? (
                  <div
                    className="flex items-center gap-2 rounded-full px-3 py-1.5"
                    style={{
                      background: 'var(--ab-badge-bg)',
                      border: '1px solid var(--ab-badge-border)',
                    }}
                  >
                    {chainIcon && <img alt={selectedChainLabel} className="w-4 h-4 rounded-full" src={chainIcon} />}
                    <span className="text-xs font-medium" style={{ color: 'var(--ab-text)' }}>
                      {truncatedAddress}
                    </span>
                    {onDisconnect && (
                      <button
                        aria-label="Disconnect wallet"
                        className="cursor-pointer p-0.5 rounded-full transition-colors"
                        onClick={onDisconnect}
                        style={{ color: 'var(--ab-text-muted)' }}
                        type="button"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              : (
                  <button
                    className="text-sm font-medium cursor-pointer transition-colors"
                    onClick={onPrimaryAction}
                    style={{ color: 'var(--ab-btn)' }}
                    type="button"
                  >
                    {t('swap.connect_wallet', 'Connect wallet')}
                  </button>
                )}

            {isAuthenticated && usdcBalance !== undefined && (
              <button
                aria-label={t('swap.use_max_balance', 'Use max balance')}
                className={`flex items-center gap-1.5 cursor-pointer transition-colors ${hasInsufficientFunds ? 'text-red-500' : ''}`}
                onClick={onBalanceClick}
                style={hasInsufficientFunds ? undefined : { color: 'var(--ab-text-muted)' }}
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
          <div className="absolute w-full" style={{ borderTop: '1px solid var(--ab-separator)' }} />
          <div
            className="relative z-10 w-9 h-9 rounded-full flex items-center justify-center shadow-sm"
            style={{
              background: 'var(--ab-card)',
              border: '1px solid var(--ab-separator)',
            }}
          >
            <ArrowDownUp className="w-4 h-4" style={{ color: 'var(--ab-text-muted)' }} />
          </div>
        </div>

        {/* Target Section */}
        <div className={`p-4 pt-3 ${isBelowMinimum || isAboveMaximum ? 'rounded-b-xl ring-1 ring-red-500/30' : ''}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {loadingTarget
                ? <Loader className="animate-spin w-6 h-6" style={{ color: 'var(--ab-text-muted)' }} />
                : (
                    <input
                      className="w-full bg-transparent font-semibold focus:outline-none text-3xl"
                      inputMode="decimal"
                      onChange={e => onTargetChange(e.target.value)}
                      onFocus={handleFocus}
                      pattern="[0-9.,]*"
                      placeholder="0.0"
                      style={{ color: (isBelowMinimum || isAboveMaximum) ? '#ef4444' : 'var(--ab-text)' }}
                      type="text"
                      value={targetAmount}
                    />
                  )}
            </div>

            {/* Currency badge → opens target modal */}
            <button
              className="shrink-0 flex items-center gap-2 rounded-full px-3 py-2 cursor-pointer transition-colors"
              onClick={onOpenTargetModal}
              style={{
                background: 'var(--ab-badge-bg)',
                border: '1px solid var(--ab-badge-border)',
              }}
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
              <span className="text-sm font-semibold" style={{ color: 'var(--ab-text)' }}>
                {targetCurrency}
              </span>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--ab-text-muted)' }} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Info Section ── */}
      <div
        className="rounded-2xl px-4 py-3 space-y-2 text-xs"
        style={{
          background: 'var(--ab-card)',
          border: '1px solid var(--ab-card-border)',
          color: 'var(--ab-text-secondary)',
        }}
      >
        {/* Exchange rate */}
        <div className="flex items-center justify-between">
          <span>{t('swap.rate', 'Rate')}</span>
          <span className="font-medium" style={{ color: 'var(--ab-text)' }}>
            1 {sourceSymbol} = {exchangeRateDisplay}
          </span>
        </div>

        {/* Fee */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5" />
            <span>{t('swap.transfer_cost', 'Transfer fee')}</span>
          </div>
          <span className="font-medium" style={{ color: 'var(--ab-text)' }}>{transferFeeDisplay}</span>
        </div>

        {/* Time */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5" />
            <span>{t('swap.time', 'Time')}</span>
          </div>
          <span className="font-medium" style={{ color: 'var(--ab-text)' }}>~30s</span>
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
        className="w-full py-4 rounded-2xl text-base font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={continueDisabled}
        onClick={onPrimaryAction}
        style={{
          background: continueDisabled ? 'var(--ab-separator)' : 'var(--ab-btn)',
          color: continueDisabled ? 'var(--ab-text-muted)' : 'var(--ab-btn-text)',
        }}
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
