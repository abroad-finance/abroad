import { useTranslate } from '@tolgee/react'
import {
  ChevronLeft,
  CircleDollarSign,
  Wallet,
  Zap,
} from 'lucide-react'
import React, { useCallback } from 'react'

import { CurrencyToggle } from '@/components/ui'
import { cn } from '@/shared/utils'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'

/* ── Props ── */

export interface SwapProps {
  continueDisabled: boolean
  exchangeRateDisplay: string
  fromQr?: boolean
  hasInsufficientFunds?: boolean
  isAboveMaximum: boolean
  isAuthenticated: boolean
  isBelowMinimum: boolean
  isMiniPay?: boolean
  isMiniPayReady?: boolean
  loadingBalance?: boolean
  loadingSource?: boolean
  loadingTarget?: boolean
  loadingWallet?: boolean
  miniPayNotice?: null | { [key: string]: unknown, title?: string }
  onBackClick?: () => void
  onBalanceClick?: () => void
  onOpenSourceModal?: () => void
  onOpenTargetModal?: () => void
  onPrimaryAction: () => void
  onRecipientChange?: (value: string) => void
  onSourceChange?: (value: string) => void
  onTargetChange: (value: string) => void
  onTaxIdChange?: (value: string) => void
  recipientName?: string
  recipientValue?: string
  selectCurrency?: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  selectedAssetLabel: string
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  taxId?: string
  transferFeeDisplay: string
  transferFeeIsZero?: boolean
  usdcBalance?: string
  walletAddress?: null | string
  walletStatusLabel?: string
  walletStatusTone?: 'info'
}

export default function Swap({
  continueDisabled,
  exchangeRateDisplay,
  fromQr = false,
  hasInsufficientFunds = false,
  isAboveMaximum,
  isAuthenticated,
  isBelowMinimum,
  loadingBalance,
  onBackClick,
  onBalanceClick,
  onPrimaryAction,
  onRecipientChange,
  onTargetChange,
  onTaxIdChange,
  recipientName,
  recipientValue = '',
  selectCurrency,
  selectedAssetLabel,
  sourceAmount,
  targetAmount,
  targetCurrency,
  taxId = '',
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

  const minMessage = targetCurrency === TargetCurrency.COP
    ? t('swap.min_cop', 'Mínimo: $5.000 COP')
    : t('swap.min_brl', 'Mínimo: R$1,00 BRL')
  const maxMessage = targetCurrency === TargetCurrency.COP
    ? t('swap.max_cop', 'Máximo: $5.000.000 COP')
    : t('swap.max_brl', 'Máximo: R$50.000,00 BRL')
  const limitMessage = isBelowMinimum ? minMessage : maxMessage

  return (
    <div
      className="mx-auto flex w-full max-w-[min(95vw,512px)] max-h-[90dvh] flex-col overflow-hidden rounded-[clamp(1.5rem,4vh,2rem)] border border-[#f3f4f6] bg-white shadow-[0px_10px_40px_-10px_rgba(0,0,0,0.08)]"
      data-name="SwapCard"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-[clamp(1rem,4vw,1.5rem)] pb-[clamp(0.25rem,1vh,0.5rem)] pt-[clamp(0.75rem,3vh,1.5rem)]">
        <div className="flex items-center gap-4">
          {onBackClick && (
            <button
              aria-label={t('swap.back', 'Back')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#f9fafb] transition-colors hover:bg-[#f3f4f6]"
              onClick={onBackClick}
              type="button"
            >
              <ChevronLeft className="h-[clamp(1.25rem,3.5vh,1.5rem)] w-[clamp(1.25rem,3.5vh,1.5rem)] text-ab-text" strokeWidth={2.5} />
            </button>
          )}
          <h1 className="text-[clamp(1rem,2.5vh+1vw,1.25rem)] font-bold leading-tight text-[#111827]">
            {t('swap.send_payment', 'Send Payment')}
          </h1>
        </div>
        {selectCurrency && (
          <CurrencyToggle
            onChange={c => selectCurrency(c)}
            value={targetCurrency}
          />
        )}
      </div>

      {/* ── Live rate banner + balance ── */}
      <div className="flex w-full items-center justify-between gap-[clamp(0.5rem,2vw,1rem)] bg-[#f0fdf4] px-[clamp(1rem,4vw,1.5rem)] py-[clamp(0.375rem,1.5vh,0.625rem)]">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#10b981]" />
          <span className="text-xs font-medium leading-4 text-[#15803d]">
            Live:
            {' '}
            {exchangeRateDisplay}
          </span>
        </div>
        {isAuthenticated
          ? (usdcBalance !== undefined && onBalanceClick && (
              <button
                className={cn(
                  'text-xs font-medium transition-colors hover:text-[#10b981]',
                  hasInsufficientFunds ? 'text-ab-error' : 'text-[#15803d]',
                )}
                onClick={onBalanceClick}
                type="button"
              >
                {t('swap.available_balance', 'Balance disponible:')}
                {' '}
                <span className="font-bold">
                  {loadingBalance ? '...' : `${usdcBalance} ${selectedAssetLabel}`}
                </span>
              </button>
            ))
          : (
              <span className="text-xs font-medium text-[#9ca3af]">
                {t('swap.connect_to_see_balance', 'Connect wallet to see balance')}
              </span>
            )}
      </div>

      {/* ── Amount section ── */}
      <div className="relative flex h-[clamp(100px,20vh,135px)] w-full shrink-0 flex-col items-center justify-center px-[clamp(1rem,4vw,1.5rem)]">
        <div className="flex flex-col items-center gap-[clamp(0.25rem,1vh,0.5rem)]">
          <div className="flex items-baseline justify-center gap-[clamp(0.25rem,1vw,0.5rem)]">
            <input
              autoFocus
              className={cn(
                'bg-transparent text-center text-[clamp(2rem,5vh+2vw,3rem)] font-black leading-[1.1] tracking-[-0.02em] outline-none caret-[#10b981] placeholder:text-[#e5e7eb]',
                (isBelowMinimum || isAboveMaximum || hasInsufficientFunds) ? 'text-ab-error' : 'text-[#111827]',
              )}
              inputMode="decimal"
              onChange={e => onTargetChange(e.target.value)}
              onFocus={handleFocus}
              placeholder={t('input.placeholder_zero', '0')}
              style={{
                minWidth: '80px',
                width: `${Math.max(4, (targetAmount || '0').length + 2)}ch`,
              }}
              type="text"
              value={targetAmount}
            />
            <span className="text-[clamp(1rem,2.5vh,1.25rem)] font-bold text-[#6b7280]">
              {targetCurrency === TargetCurrency.BRL ? 'BRL' : 'COP'}
            </span>
          </div>
          <div className="flex items-center gap-[clamp(0.25rem,1vw,0.5rem)]">
            <span className="text-[clamp(0.875rem,2vh,1rem)] font-medium text-[#6b7280]">
              $
              {' '}
              {sourceAmount || '0.00'}
              {' '}
              {selectedAssetLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Min/Max warnings – right below amount */}
      {(isBelowMinimum || isAboveMaximum) && (
        <div className="flex items-center justify-center gap-[clamp(0.25rem,1vw,0.5rem)] px-[clamp(1rem,4vw,1.5rem)] pb-[clamp(0.25rem,1vh,0.5rem)] text-[clamp(0.75rem,1.5vh,0.875rem)] font-bold text-ab-error">
          <CircleDollarSign className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)]" />
          <span>{limitMessage}</span>
        </div>
      )}

      {/* ── Separator ── */}
      <div className="h-px w-full shrink-0 border-t border-[#f3f4f6]" />

      {/* ── Send to + Fee + Speed + CTA ── */}
      <div className="flex flex-col gap-[clamp(0.5rem,2vh,1rem)] p-[clamp(1rem,4vw,1.5rem)] overflow-y-auto">
        {/* Send to */}
        {fromQr
          ? (
              <div className="relative">
                <label className="absolute left-1 top-0 -translate-y-1/2 text-xs font-bold uppercase tracking-[0.6px] text-[#6b7280]">
                  {t('swap.send_to', 'Send to')}
                </label>
                <div className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-[19px]">
                  {recipientName && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="shrink-0 text-sm text-ab-text-3">{t('swap.recipient_name_label', 'Nombre')}</span>
                      <span className="break-all text-right text-sm font-semibold text-ab-text">{recipientName}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span className="shrink-0 text-sm text-ab-text-3">
                      {targetCurrency === TargetCurrency.BRL
                        ? t('swap.pix_key_label', 'Clave PIX')
                        : t('swap.breb_key_label', 'Clave Bre-B')}
                    </span>
                    <span className="break-all text-right font-mono text-sm font-medium text-ab-text">{recipientValue}</span>
                  </div>
                </div>
                <span className="mt-2 block pl-1 font-medium text-xs text-ab-text-3">
                  {targetCurrency === TargetCurrency.BRL
                    ? t('bank_details.pix_disclaimer', 'Tu transacción será procesada de inmediato. Asegúrate de que la llave PIX y el CPF del destinatario sean correctos. Esta transacción no se puede reversar.')
                    : t('bank_details.breb_disclaimer', 'Tu transacción será procesada de inmediato a través de BRE-B. Ingresa la llave correcta del destinatario y asegurate que la tenga inscrita. No es necesario seleccionar banco.')}
                </span>
              </div>
            )
          : (
              <div className="relative mt-3">
                <label
                  className="absolute left-4 -top-2.5 bg-white px-1 text-xs font-bold uppercase tracking-[0.6px] text-[#6b7280]"
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
                {targetCurrency === TargetCurrency.BRL && onTaxIdChange && (
                  <div className="relative mt-3">
                    <label
                      className="absolute left-4 -top-2.5 bg-white px-1 text-xs font-bold uppercase tracking-[0.6px] text-[#6b7280]"
                      htmlFor="swap-cpf"
                    >
                      {t('bank_details.cpf_placeholder', 'CPF')}
                    </label>
                    <input
                      className="w-full rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-[19px] text-base text-[#111827] placeholder:text-[#9ca3af] focus:border-[#10b981] focus:outline-none focus:ring-1 focus:ring-[#10b981]"
                      id="swap-cpf"
                      inputMode="numeric"
                      onChange={e => onTaxIdChange(e.target.value.replace(/[^\d]/g, ''))}
                      pattern="[0-9]*"
                      placeholder={t('bank_details.cpf_placeholder', 'CPF')}
                      type="text"
                      value={taxId}
                    />
                  </div>
                )}
                <span className="mt-2 block pl-1 font-medium text-xs text-ab-text-3">
                  {targetCurrency === TargetCurrency.BRL
                    ? t('bank_details.pix_disclaimer', 'Tu transacción será procesada de inmediato. Asegúrate de que la llave PIX y el CPF del destinatario sean correctos. Esta transacción no se puede reversar.')
                    : t('bank_details.breb_disclaimer', 'Tu transacción será procesada de inmediato a través de BRE-B. Ingresa la llave correcta del destinatario y asegurate que la tenga inscrita. No es necesario seleccionar banco.')}
                </span>
              </div>
            )}

        {/* Fee + Speed */}
        <div className="flex flex-col gap-[clamp(0.25rem,1vh,0.5rem)] rounded-[clamp(1rem,3vh,1.25rem)] border border-[#f3f4f6] bg-[#f9fafb] p-[clamp(0.75rem,2.5vh,1rem)]">
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
            !isAuthenticated
              ? 'bg-[#059669] text-[#f0fdf4] hover:bg-[#047857]'
              : (continueDisabled || hasInsufficientFunds)
                  ? 'cursor-not-allowed bg-[#e5e7eb] text-[#9ca3af]'
                  : 'bg-[#059669] text-[#f0fdf4] hover:bg-[#047857]',
          )}
          disabled={isAuthenticated && (continueDisabled || hasInsufficientFunds)}
          onClick={onPrimaryAction}
          type="button"
        >
          {!isAuthenticated
            ? (
                <span className="flex items-center gap-2">
                  <Wallet className="h-6 w-6" />
                  {t('swap.connect_wallet_to_continue', 'Connect Wallet to Continue')}
                </span>
              )
            : (hasInsufficientFunds
                ? ctaLabelDisabled
                : ctaLabelEnabled)}
        </button>
      </div>
    </div>
  )
}
