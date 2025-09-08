import { useTranslate } from '@tolgee/react'
import { ArrowLeft, Hash, Rotate3d } from 'lucide-react'
import React from 'react'

import PixFull from '../../../assets/Logos/networks/PixFull.svg'
import { Button } from '../../../shared/components/Button'

export interface ConfirmQrProps {
  isDesktop?: boolean
  onBack: () => void
  onConfirm: () => void
  onEdit: () => void
  pixKey?: string
  sourceAmount?: string
  targetAmount?: string
  taxId?: string
}

const ConfirmQr: React.FC<ConfirmQrProps> = ({
  isDesktop,
  onBack,
  onConfirm,
  onEdit,
  pixKey,
  sourceAmount,
  targetAmount,
  taxId,
}) => {
  const { t } = useTranslate()
  const textColor = isDesktop ? 'white' : '#356E6A'

  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div
        className="w-[98%] max-w-md min-h-[60vh] h-auto bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center space-y-4"
        id="bg-container"
      >
        {/* Header */}
        <div className="w-full flex items-center space-x-3 mb-2 flex-shrink-0">
          <button
            aria-label={t('confirm_qr.back_aria', 'Go back')}
            className="hover:text-opacity-80 transition-colors cursor-pointer"
            onClick={onBack}
            style={{ color: textColor }}
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div
            className="text-xl sm:text-2xl font-bold flex-grow text-center"
            id="Title"
            style={{ color: textColor }}
          >
            {t('confirm_qr.title', 'Confirmar detalles del pago')}
          </div>
        </div>

        {/* Currency Exchange Display */}
        <div className="flex-1 flex flex-col items-center justify-center w-full space-y-3 py-4">
          {/* Destination Currency - Primary display (larger) */}
          <div className="flex items-center space-x-3">
            <img
              alt="Brazil flag"
              className="w-6 h-6 rounded-full"
              src="https://hatscripts.github.io/circle-flags/flags/br.svg"
            />
            <span className="text-6xl font-bold" style={{ color: textColor }}>
              R$
              {targetAmount || '—'}
            </span>
          </div>

          {/* Equal sign and Origin Currency on same line */}
          <div className="flex items-center space-x-3">
            <span className="text-2xl font-bold" style={{ color: textColor }}>=</span>
            <img
              alt="USDC Token"
              className="w-6 h-6"
              src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
            />
            <span className="text-lg font-semibold" style={{ color: textColor }}>
              $
              {sourceAmount || '—'}
            </span>
          </div>
        </div>

        {/* Payment Details Disclaimer */}
        <div
          className="relative w-full bg-white/10 backdrop-blur-xl rounded-2xl p-3 sm:p-4 flex flex-col space-y-3"
          id="payment-details-disclaimer"
          style={{ color: textColor }}
        >
          <div className="flex items-center space-x-2">
            <Rotate3d className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-xs sm:text-sm">{t('confirm_qr.network', 'Red:')}</span>
            <div className="bg-white/70 backdrop-blur-md rounded-lg px-2 py-1 flex items-center">
              <img alt="PIX Logo" className="h-3 sm:h-4 w-auto" src={PixFull} />
            </div>
          </div>

          {/* PIX Key */}
          {pixKey && (
            <div className="flex items-center space-x-2">
              <Hash className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="font-medium text-xs sm:text-sm">{t('confirm_qr.pix_key', 'Llave PIX:')}</span>
              <span className="font-medium text-xs break-all">{pixKey}</span>
            </div>
          )}

          {/* Tax ID */}
          {taxId && (
            <div className="flex items-center space-x-2">
              <Hash className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="font-medium text-xs sm:text-sm">{t('confirm_qr.tax_id', 'CPF:')}</span>
              <span className="font-medium text-xs">{taxId}</span>
            </div>
          )}

          <span className="font-medium text-xs pl-1" style={{ color: textColor }}>
            {t(
              'confirm_qr.disclaimer',
              'Tu transacción será procesada de inmediato. Asegúrate de que la llave PIX y el CPF sean correctos. Esta transacción no se puede reversar.',
            )}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-4 flex gap-3 w-[90%] max-w-md">
        <button
          className="flex-1 py-4 bg-transparent border border-[#356E6A] rounded-xl font-semibold hover:bg-[#356E6A]/10 transition-colors"
          onClick={onEdit}
          style={{ color: textColor }}
          type="button"
        >
          {t('confirm_qr.edit', 'Editar')}
        </button>
        <Button
          className="flex-1 py-4"
          onClick={onConfirm}
          type="button"
        >
          {t('confirm_qr.confirm', 'Confirmar')}
        </Button>
      </div>
    </div>
  )
}

export default ConfirmQr
