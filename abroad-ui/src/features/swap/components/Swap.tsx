import { useTranslate } from '@tolgee/react'
import {
  ChevronLeft,
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
  sourceAmountForBalanceCheck?: string
  sourceSymbol: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  targetSymbol: string
  textColor?: string
  toggleAssetMenu?: () => void
  toggleChainMenu?: () => void
  toggleCurrencyMenu?: () => void
  transferFeeDisplay: string
  transferFeeIsZero?: boolean
  usdcBalance?: string
  walletAddress?: null | string
}

export default function Swap({
  continueDisabled,
  exchangeRateDisplay,
  hasInsufficientFunds = false,
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
  transferFeeIsZero = false,
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

  const ctaLabelDisabled = hasInsufficientFunds
    ? t('swap.insufficient_balance', 'Saldo insuficiente')
    : t('swap.enter_amount', 'Enter amount')
  const formattedAmount = targetCurrency === TargetCurrency.BRL
    ? `R$${targetAmount}`
    : `$${targetAmount}`
  const ctaLabelEnabled = targetAmount
    ? t('swap.send_amount', 'Send {amount}', { amount: formattedAmount })
    : t('swap.continue', 'Continuar')

  const ctaLabel = (continueDisabled || hasInsufficientFunds) ? ctaLabelDisabled : ctaLabelEnabled

  const minMessage = targetCurrency === TargetCurrency.COP
    ? t('swap.min_cop', 'Mínimo: $5.000 COP')
    : t('swap.min_brl', 'Mínimo: R$1,00 BRL')
  const maxMessage = targetCurrency === TargetCurrency.COP
    ? t('swap.max_cop', 'Máximo: $5.000.000 COP')
    : t('swap.max_brl', 'Máximo: R$50.000,00 BRL')
  const limitMessage = isBelowMinimum ? minMessage : maxMessage

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
              <ChevronLeft className="h-6 w-6 text-ab-text" strokeWidth={2.5} />
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

      {/* ── Live rate banner + balance ── */}
      <div className="flex w-full items-center justify-between gap-4 bg-[#f0fdf4] px-6 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#10b981]" />
          <span className="text-xs font-medium leading-4 text-[#15803d]">
            Live: {exchangeRateDisplay}
          </span>
        </div>
        {isAuthenticated && usdcBalance !== undefined && onBalanceClick && (
          <button
            className={cn(
              'text-xs font-medium transition-colors hover:text-[#10b981]',
              hasInsufficientFunds ? 'text-ab-error' : 'text-[#15803d]'
            )}
            onClick={onBalanceClick}
            type="button"
          >
            {t('swap.available_balance', 'Balance disponible:')}{' '}
            <span className="font-bold">
              {loadingBalance ? '...' : `${usdcBalance} ${selectedAssetLabel}`}
            </span>
          </button>
        )}
      </div>

      {/* ── Amount section ── */}
      <div className="relative flex h-[135px] w-full shrink-0 flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-baseline justify-center gap-1">
            <input
              autoFocus
              className={cn(
                'bg-transparent text-center text-[48px] font-black leading-[48px] tracking-[-2.4px] outline-none caret-[#10b981] placeholder:text-[#e5e7eb]',
                (isBelowMinimum || isAboveMaximum || hasInsufficientFunds) ? 'text-ab-error' : 'text-[#111827]'
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

      {/* Min/Max warnings – right below amount */}
      {(isBelowMinimum || isAboveMaximum) && (
        <div className="flex items-center justify-center gap-2 px-6 pb-2 text-xs font-bold text-ab-error">
          <CircleDollarSign className="h-4 w-4" />
          <span>{limitMessage}</span>
        </div>
      )}

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
          <span className="mt-2 block pl-1 font-medium text-xs text-ab-text-3">
            {targetCurrency === TargetCurrency.BRL
              ? t('bank_details.pix_disclaimer', 'Tu transacción será procesada de inmediato. Asegúrate de que la llave PIX y el CPF del destinatario sean correctos. Esta transacción no se puede reversar.')
              : t('bank_details.breb_disclaimer', 'Tu transacción será procesada de inmediato a través de BRE-B. Ingresa la llave correcta del destinatario y asegurate que la tenga inscrita. No es necesario seleccionar banco.')}
          </span>
        </div>

        {/* Fee + Speed */}
        <div className="flex flex-col gap-2 rounded-2xl border border-[#f3f4f6] bg-[#f9fafb] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-normal text-[#6b7280]">
              {transferFeeIsZero
                ? t('swap.fee', 'Fee')
                : t('swap.fee_percent', 'Fee (1.5%)')}
            </span>
            <span
              className={cn(
                'text-sm font-medium',
                transferFeeIsZero ? 'text-[#10b981]' : 'text-[#111827]',
              )}
            >
              {transferFeeIsZero ? t('swap.free', 'Gratis') : transferFeeDisplay}
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

        {/* Primary CTA ── Figma: disabled = gray, enabled = green #059669 */}
        <button
          className={cn(
            'flex w-full items-center justify-center rounded-2xl py-4 text-lg font-bold transition-all active:scale-[0.98]',
            continueDisabled || hasInsufficientFunds
              ? 'cursor-not-allowed bg-[#e5e7eb] text-[#9ca3af]'
              : 'bg-[#059669] text-[#f0fdf4] hover:bg-[#047857]'
          )}
          disabled={continueDisabled || hasInsufficientFunds}
          onClick={onPrimaryAction}
          type="button"
        >
          {!isAuthenticated ? (
            <span className="flex items-center gap-2">
              <Wallet className="h-6 w-6" />
              {t('swap.connect_wallet', 'Conectar Billetera')}
            </span>
          ) : ctaLabel}
        </button>
      </div>
    </div>
  )
}
