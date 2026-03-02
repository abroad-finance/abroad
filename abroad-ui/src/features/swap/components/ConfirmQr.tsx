import { useTranslate } from '@tolgee/react'
import { ArrowLeft, Loader } from 'lucide-react'
import React, { memo, useMemo } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { ASSET_URLS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'

const TOKEN_ICON: Record<string, string> = {
  USDC: ASSET_URLS.USDC_TOKEN_ICON,
  USDT: ASSET_URLS.USDT_TOKEN_ICON,
}

export interface ConfirmQrProps {
  currency: TargetCurrency
  loadingSubmit?: boolean
  onBack: () => void
  onConfirm: () => void
  onEdit: () => void
  selectedAssetLabel?: string
  sourceAmount?: string
  targetAmount?: string
}

const FLAG_URL: Record<string, string> = {
  BRL: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
  COP: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
}

const ConfirmQr: React.FC<ConfirmQrProps> = ({
  currency,
  loadingSubmit,
  onBack,
  onConfirm,
  onEdit,
  selectedAssetLabel = 'USDC',
  sourceAmount,
  targetAmount,
}) => {
  const { t } = useTranslate()
  const isBRL = currency === TargetCurrency.BRL

  const targetSymbol = isBRL ? 'R$' : '$'

  const disclaimerText = useMemo(() => {
    if (isBRL) {
      return t(
        'confirm_qr.disclaimer',
        'Tu transacción será procesada de inmediato. Asegúrate de que la llave PIX y el CPF sean correctos. Esta transacción no se puede reversar.',
      )
    }
    return t(
      'confirm_qr.disclaimer_cop',
      'Tu transacción será procesada de inmediato. Asegúrate de que el número de cuenta y datos sean los correctos. Esta transacción no se puede reversar.',
    )
  }, [isBRL, t])

  return (
    <div className="flex flex-1 flex-col items-center justify-center w-full px-4">
      <div
        className={cn(
          'w-full max-w-[448px] flex flex-col gap-10 rounded-[24px] p-8',
          'bg-white/90 backdrop-blur-sm shadow-[0px_4px_20px_-2px_rgba(0,0,0,0.05)]',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            aria-label={t('confirm_qr.back_aria', 'Go back')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-ab-hover"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft className="h-5 w-5 text-ab-text" />
          </button>
          <h2 className="text-lg font-bold leading-7 text-ab-text">
            {t('confirm_qr.title', 'Verifica los detalles del pago')}
          </h2>
        </div>

        {/* Amount section */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3 pb-2">
            <img
              alt={isBRL ? 'Brazil flag' : 'Colombia flag'}
              className="h-8 w-8 shrink-0 rounded-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
              src={FLAG_URL[currency] ?? FLAG_URL.COP}
            />
            <span className="text-[48px] font-extrabold leading-[48px] tracking-[-1.2px] text-ab-text">
              {targetSymbol}
              {' '}
              {targetAmount || '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium text-ab-text-3">=</span>
            <img
              alt={selectedAssetLabel}
              className="h-5 w-5 shrink-0 object-contain"
              src={TOKEN_ICON[selectedAssetLabel] ?? TOKEN_ICON.USDC}
            />
            <span className="text-lg font-medium text-ab-text-3">
              $
              {sourceAmount || '—'}
            </span>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="rounded-2xl bg-ab-separator/60 px-4 py-6">
          <p className="text-center text-sm leading-5 text-ab-text-3">
            {disclaimerText}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-6 flex w-full max-w-[448px] gap-4">
        <button
          className={cn(
            'flex flex-1 items-center justify-center rounded-2xl border border-ab-border px-6 py-[13px]',
            'text-base font-semibold text-ab-text-secondary',
            'transition-colors hover:bg-ab-hover',
          )}
          onClick={onEdit}
          type="button"
        >
          {t('confirm_qr.edit', 'Editar')}
        </button>
        <button
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-[13px]',
            'bg-ab-green text-base font-semibold text-white',
            'shadow-[0px_10px_15px_-3px_rgba(15,190,123,0.3),0px_4px_6px_-4px_rgba(15,190,123,0.3)]',
            'transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70',
          )}
          disabled={loadingSubmit}
          onClick={onConfirm}
          type="button"
        >
          {loadingSubmit ? (
            <Loader className="h-5 w-5 animate-spin" />
          ) : (
            t('confirm_qr.confirm', 'Continuar')
          )}
        </button>
      </div>
    </div>
  )
}

export default memo(ConfirmQr)
