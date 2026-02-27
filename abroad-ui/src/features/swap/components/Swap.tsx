import { useTranslate } from '@tolgee/react'
import {
  ArrowLeft,
  CircleDollarSign,
  Wallet,
  Zap,
} from 'lucide-react'
import React, { useCallback } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { CurrencyToggle } from '../../../components/ui'
import { cn } from '../../../shared/utils'

/* ── Props ── */

export interface SwapProps {
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
  onBackClick?: () => void
  onDisconnect?: () => void
  onOpenSourceModal: () => void
  onOpenTargetModal: () => void
  onPrimaryAction: () => void
  onRecipientChange?: (value: string) => void
  onSourceChange: (value: string) => void
  onTargetChange: (value: string) => void
  openQr?: () => void
  recipientValue?: string
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
  isAboveMaximum,
  isAuthenticated,
  isBelowMinimum,
  loadingBalance,
  onBalanceClick,
  onBackClick,
  onOpenSourceModal: _onOpenSourceModal,
  onOpenTargetModal: _onOpenTargetModal,
  onPrimaryAction,
  onRecipientChange,
  onSourceChange: _onSourceChange,
  onTargetChange,
  recipientValue = '',
  selectCurrency,
  selectedAssetLabel,
  sourceAmount,
  targetAmount,
  targetCurrency,
  transferFeeDisplay,
  usdcBalance,
}: SwapProps): React.JSX.Element {
  const { t } = useTranslate()

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
  }, [])

  const sendToPlaceholder = targetCurrency === TargetCurrency.BRL
    ? t('swap.send_to_placeholder_pix', 'Chave Pix ou número de telefone')
    : t('swap.send_to_placeholder_breb', 'Bre-B ID ou número de telefone')

  const ctaLabelDisabled = t('swap.enter_amount', 'Enter amount')
  const formattedAmount = targetCurrency === TargetCurrency.BRL
    ? `R$${targetAmount}`
    : `$${targetAmount}`
  const ctaLabelEnabled = targetAmount
    ? t('swap.send_amount', 'Send {amount}', { amount: formattedAmount })
    : t('swap.continue', 'Continuar')

  return (
    <div
      className="mx-auto flex w-full max-w-[512px] flex-col overflow-hidden rounded-[32px] border border-[#f3f4f6] bg-white shadow-[0px_10px_40px_-10px_rgba(0,0,0,0.08)]"
      data-name="SwapCard"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 pb-2 pt-6">
        <div className="flex items-center gap-4">
          {onBackClick && (
            <button
              aria-label="Back"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#f9fafb] transition-colors hover:bg-[#f3f4f6]"
              onClick={onBackClick}
              type="button"
            >
              <ArrowLeft className="h-[16px] w-[9px] text-[#111827]" />
            </button>
          )}
          <h1 className="text-xl font-bold leading-7 text-[#111827]">
            {t('swap.send_payment', 'Send Payment')}
          </h1>
        </div>
        {selectCurrency && (
          <CurrencyToggle
            value={targetCurrency}
            onChange={(c) => selectCurrency(c)}
          />
        )}
      </div>

      {/* ── Live rate banner ── */}
      <div className="flex w-full items-center gap-2 bg-[#f0fdf4] px-6 py-2.5">
        <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#10b981]" />
        <span className="text-xs font-medium leading-4 text-[#15803d]">
          Live: {exchangeRateDisplay}
        </span>
      </div>

      {/* ── Amount section ── */}
      <div className="relative flex h-[135px] w-full shrink-0 flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-baseline justify-center gap-1">
            <input
              autoFocus
              className={cn(
                'bg-transparent text-center text-[48px] font-black leading-[48px] tracking-[-2.4px] outline-none caret-[#10b981] placeholder:text-[#e5e7eb]',
                (isBelowMinimum || isAboveMaximum) ? 'text-ab-error' : 'text-[#111827]'
              )}
              inputMode="decimal"
              onChange={e => onTargetChange(e.target.value)}
              onFocus={handleFocus}
              placeholder="0"
              style={{
                width: `${Math.max(4, (targetAmount || '0').length + 2)}ch`,
                minWidth: '80px',
              }}
              type="text"
              value={targetAmount}
            />
            <span className="text-xl font-bold text-[#6b7280]">
              {targetCurrency === TargetCurrency.BRL ? 'BRL' : 'COP'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#6b7280]">
              $ {sourceAmount || '0.00'} {selectedAssetLabel}
            </span>
          </div>
        </div>
      </div>

      {/* ── Separator ── */}
      <div className="h-px w-full shrink-0 border-t border-[#f3f4f6]" />

      {/* ── Send to + Fee + Speed + CTA ── */}
      <div className="flex flex-col gap-4 p-6">
        {/* Send to */}
        <div className="relative">
          <label
            className="absolute left-1 top-0 -translate-y-1/2 text-xs font-bold uppercase tracking-[0.6px] text-[#6b7280]"
            htmlFor="swap-send-to"
          >
            {t('swap.send_to', 'Send to')}
          </label>
          <input
            className="w-full rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-[19px] text-base text-[#111827] placeholder:text-[#9ca3af] focus:border-[#10b981] focus:outline-none focus:ring-1 focus:ring-[#10b981]"
            id="swap-send-to"
            onChange={e => onRecipientChange?.(e.target.value)}
            placeholder={sendToPlaceholder}
            type="text"
            value={recipientValue}
          />
        </div>

        {/* Fee + Speed */}
        <div className="flex flex-col gap-2 rounded-2xl border border-[#f3f4f6] bg-[#f9fafb] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-normal text-[#6b7280]">
              {t('swap.fee_percent', 'Fee (1.5%)')}
            </span>
            <span className="text-sm font-medium text-[#111827]">
              {transferFeeDisplay}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-normal text-[#6b7280]">
              {t('swap.speed', 'Speed')}
            </span>
            <div className="flex items-center gap-1 text-sm font-medium text-[#10b981]">
              <Zap className="h-3.5 w-3.5" />
              ~30s
            </div>
          </div>
        </div>

        {/* Min/Max warnings */}
        {(isBelowMinimum || isAboveMaximum) && (
          <div className="flex items-center gap-2 text-xs font-bold text-ab-error">
            <CircleDollarSign className="h-4 w-4" />
            <span>
              {isBelowMinimum
                ? (targetCurrency === TargetCurrency.COP
                  ? t('swap.min_cop', 'Mínimo: $5.000 COP')
                  : t('swap.min_brl', 'Mínimo: R$1,00 BRL'))
                : (targetCurrency === TargetCurrency.COP
                  ? t('swap.max_cop', 'Máximo: $5.000.000 COP')
                  : t('swap.max_brl', 'Máximo: R$50.000,00 BRL'))}
            </span>
          </div>
        )}

        {/* Primary CTA ── Figma: disabled = gray, enabled = green #059669 */}
        <button
          className={cn(
            'flex w-full items-center justify-center rounded-2xl py-4 text-lg font-bold transition-all active:scale-[0.98]',
            continueDisabled
              ? 'cursor-not-allowed bg-[#e5e7eb] text-[#9ca3af]'
              : 'bg-[#059669] text-[#f0fdf4] hover:bg-[#047857]'
          )}
          disabled={continueDisabled}
          onClick={onPrimaryAction}
          type="button"
        >
          {!isAuthenticated ? (
            <span className="flex items-center gap-2">
              <Wallet className="h-6 w-6" />
              {t('swap.connect_wallet', 'Conectar Billetera')}
            </span>
          ) : (
            continueDisabled ? ctaLabelDisabled : ctaLabelEnabled
          )}
        </button>

        {/* Balance helper */}
        {isAuthenticated && usdcBalance !== undefined && onBalanceClick && (
          <button
            className="flex items-center justify-center gap-2 text-sm font-medium text-[#6b7280] transition-colors hover:text-[#10b981]"
            onClick={onBalanceClick}
            type="button"
          >
            <Wallet className="h-4 w-4" />
            <span>{t('swap.available_balance', 'Balance disponible:')}</span>
            <span className="font-bold text-[#111827]">
              {loadingBalance ? '...' : `${usdcBalance} ${selectedAssetLabel}`}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
