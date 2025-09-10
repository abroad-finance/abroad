import { useTranslate } from '@tolgee/react'
import { ArrowLeft, Hash, Loader, Rotate3d } from 'lucide-react'
import React, { memo, useMemo } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import PixFull from '../../../assets/Logos/networks/PixFull.svg'
import { Button } from '../../../shared/components/Button'

export interface ConfirmQrProps {
  currency: TargetCurrency
  loadingSubmit?: boolean
  onBack: () => void
  onConfirm: () => void
  onEdit: () => void
  pixKey?: string
  recipentName?: string
  sourceAmount?: string
  targetAmount?: string
  taxId?: string
}

const ConfirmQr: React.FC<ConfirmQrProps> = ({
  currency,
  loadingSubmit,
  onBack,
  onConfirm,
  onEdit,
  pixKey,
  recipentName,
  sourceAmount,
  targetAmount,
  taxId,
}) => {
  const { t } = useTranslate()
  const isRealBRL = currency === TargetCurrency.BRL

  const showMissingMessage = () => {
    if (!isRealBRL) {
      return <></>
    }
    if (!pixKey || !sourceAmount || !targetAmount || !taxId) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-center text-sm">
            {t('confirm_qr.missing_data', 'Faltan datos para completar la transacción, al continuar serás redirigido a la pantalla de intercambio para ingresar los datos faltantes.')}
          </p>
        </div>
      )
    }
  }

  const getButtonText = useMemo(() => {
    if (!isRealBRL) {
      return t('confirm_qr.confirm', 'Confirmar')
    }
    if (!pixKey || !sourceAmount || !targetAmount || !taxId) {
      return t('confirm_qr.continue', 'Continuar')
    }
    return t('confirm_qr.confirm', 'Confirmar')
  }, [
    isRealBRL,
    pixKey,
    sourceAmount,
    t,
    targetAmount,
    taxId,
  ])

  const confirmationText = useMemo(() => {
    if (isRealBRL) {
      return t(
        'confirm_qr.disclaimer',
        'Tu transacción será procesada de inmediato. Asegúrate de que la llave PIX y el CPF sean correctos. Esta transacción no se puede reversar.',
      )
    }
    else {
      return t(
        'confirm_qr.disclaimer_cop',
        'Tu transacción será procesada de inmediato. Asegúrate de que el número de cuenta y datos sean los correctos. Esta transacción no se puede reversar.',
      )
    }
  }, [isRealBRL, t])

  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col text-abroad-dark md:text-white">
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

          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div
            className="text-xl sm:text-2xl font-bold flex-grow text-center"
            id="Title"

          >
            {t('confirm_qr.title', 'Confirmar detalles del pago')}
          </div>
        </div>

        {
          isRealBRL
          && (
            <div className="text-bold mt-10">
              <span className="text-lg font-semibold">
                {t('confirm_qr.recipent_name', 'Nombre del destinatario:')}
              </span>
              <br />
              <span className="text-xl ">{recipentName}</span>
            </div>
          )
        }

        {/* Currency Exchange Display */}
        <div className="flex-1 flex flex-col items-center justify-center w-full space-y-3 py-4">
          {/* Destination Currency - Primary display (larger) */}
          <div className="flex items-center space-x-3">
            <img
              alt="Brazil flag"
              className="w-6 h-6 rounded-full"
              src={isRealBRL ? 'https://hatscripts.github.io/circle-flags/flags/br.svg' : 'https://hatscripts.github.io/circle-flags/flags/co.svg'}
            />
            <span className="text-6xl font-bold">{isRealBRL ? 'R$' : '$'}</span>
            <span className="text-6xl font-bold">
              {targetAmount || '—'}
            </span>
          </div>

          {/* Equal sign and Origin Currency on same line */}
          <div className="flex items-center space-x-3">
            <span className="text-2xl font-bold">=</span>
            <img
              alt="USDC Token"
              className="w-6 h-6"
              src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
            />
            <span className="text-lg font-semibold">
              $
              {sourceAmount || '—'}
            </span>
          </div>
        </div>

        {/* Payment Details Disclaimer */}
        <div
          className="relative w-full bg-white/10 backdrop-blur-xl rounded-2xl p-3 sm:p-4 flex flex-col space-y-3"
          id="payment-details-disclaimer"

        >
          {
            isRealBRL
            && (
              <div className="flex items-center space-x-2">
                <Rotate3d className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="font-medium text-xs sm:text-sm">{t('confirm_qr.network', 'Red:')}</span>
                <div className="bg-white/70 backdrop-blur-md rounded-lg px-2 py-1 flex items-center">
                  <img alt="PIX Logo" className="h-3 sm:h-4 w-auto" src={PixFull} />
                </div>
              </div>
            )
          }

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

          <span className="font-medium text-xs pl-1">
            {confirmationText}
          </span>
        </div>

        {/* Missing Data Message */}
        {showMissingMessage()}
      </div>

      {/* Action Buttons */}
      <div className="mt-4 flex gap-3 w-[90%] max-w-md">
        <button
          className="flex-1 py-4 bg-transparent border border-[#356E6A] rounded-xl font-semibold hover:bg-[#356E6A]/10 transition-colors"
          onClick={onEdit}
          type="button"
        >
          {t('confirm_qr.edit', 'Editar')}
        </button>
        <Button
          className="flex-1 py-4"
          onClick={onConfirm}
          type="button"
        >
          {loadingSubmit
            ? (
                <Loader className="animate-spin w-4 h-4 sm:w-5 sm:h-5" />
              )
            : getButtonText}
        </Button>
      </div>
    </div>
  )
}

export default memo(ConfirmQr)
