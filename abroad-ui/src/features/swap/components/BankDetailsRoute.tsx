import { useTranslate } from '@tolgee/react'
import {
  ArrowLeft, Hash, Rotate3d,
} from 'lucide-react'
import React from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import BreBLogo from '../../../assets/Logos/networks/Bre-b.svg'
import PixFull from '../../../assets/Logos/networks/PixFull.svg'
import { Button } from '../../../shared/components/Button'

export interface BankDetailsRouteProps {
  accountNumber: string
  continueDisabled: boolean
  onAccountNumberChange: (value: string) => void
  onBackClick: () => void
  onContinue: () => void
  onPixKeyChange: (value: string) => void
  onTaxIdChange: (value: string) => void
  pixKey: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  taxId: string
  textColor?: string
}

export default function BankDetailsRoute({
  accountNumber,
  continueDisabled,
  onAccountNumberChange,
  onBackClick,
  onContinue,
  onPixKeyChange,
  onTaxIdChange,
  pixKey,
  targetAmount,
  targetCurrency,
  taxId,
  textColor,
}: BankDetailsRouteProps): React.JSX.Element {
  const { t } = useTranslate()
  const colorStyle = textColor ? { color: textColor } : { color: 'var(--ab-text)' }
  const mutedStyle = textColor ? { color: textColor } : { color: 'var(--ab-text-muted)' }

  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div
        className="w-full rounded-2xl p-4 md:p-6 flex flex-col items-center space-y-4 bg-abroad-dark/5 backdrop-blur-xl min-h-0"
        id="bg-container"
      >
        {/* Header */}
        <div className="w-full flex items-center space-x-3 mb-2 flex-shrink-0">
          <button
            aria-label={t('bank_details.back_aria', 'Go back')}
            className="hover:text-opacity-80 transition-colors cursor-pointer"
            onClick={onBackClick}
            style={colorStyle}
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div
            className="text-xl sm:text-2xl font-bold flex-grow text-center"
            id="Title"
            style={colorStyle}
          >
            {t('bank_details.title', 'Datos del destinatario')}
          </div>
        </div>

        {/* Inputs */}
        <div className="flex-1 flex flex-col items-center justify-center w-full space-y-3 py-2">
          {targetCurrency === TargetCurrency.BRL
            ? (
                <>
                  {/* PIX Key */}
                  <div className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3" id="pix-key-input">
                    <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={colorStyle} />
                    <input
                      className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                      inputMode="text"
                      onChange={e => onPixKeyChange(e.target.value)}
                      placeholder={t('bank_details.pix_key_placeholder', 'PIX Key')}
                      style={colorStyle}
                      type="text"
                      value={pixKey}
                    />
                  </div>
                  {/* CPF */}
                  <div className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3" id="cpf-input">
                    <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={colorStyle} />
                    <input
                      className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                      inputMode="numeric"
                      onChange={e => onTaxIdChange(e.target.value)}
                      pattern="[0-9]*"
                      placeholder={t('bank_details.cpf_placeholder', 'CPF')}
                      style={colorStyle}
                      type="text"
                      value={taxId}
                    />
                  </div>
                </>
              )
            : (
                <>
                  {/* BreB key */}
                  <div
                    className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3"
                    id="recipient-key-input"
                  >
                    <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={colorStyle} />
                    <input
                      className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                      inputMode="text"
                      onChange={e => onAccountNumberChange(e.target.value)}
                      placeholder={t('bank_details.breb_key_placeholder', 'Clave BRE-B')}
                      style={colorStyle}
                      type="text"
                      value={accountNumber}
                    />
                  </div>
                </>
              )}

          {/* Amount info */}
          <div
            className="relative font-medium w-full flex items-center space-x-1"
            id="tx-info"
            style={colorStyle}
          >
            <span className="text-sm sm:text-base">{t('bank_details.amount_to_receive', 'Monto a recibir:')}</span>
            <img
              alt={targetCurrency === TargetCurrency.BRL ? 'Brazil flag' : 'Colombia flag'}
              className="w-4 h-4 sm:w-5 sm:h-5 rounded-full"
              src={
                targetCurrency === TargetCurrency.BRL
                  ? 'https://hatscripts.github.io/circle-flags/flags/br.svg'
                  : 'https://hatscripts.github.io/circle-flags/flags/co.svg'
              }
            />
            <b className="text-sm sm:text-base">
              {' '}
              {targetCurrency === TargetCurrency.BRL ? 'R$' : '$'}
              {targetAmount}
            </b>
          </div>
        </div>

        {/* Disclaimer */}
        <div
          className="relative w-full bg-white/10 backdrop-blur-xl rounded-2xl p-3 sm:p-4 flex flex-col space-y-2"
          id="transfer-disclaimer"
          style={mutedStyle}
        >
          {targetCurrency === TargetCurrency.BRL
            ? (
                <>
                  <div className="flex items-center space-x-2">
                    <Rotate3d className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="font-medium text-xs sm:text-sm">{t('bank_details.network', 'Red:')}</span>
                    <div className="bg-white/70 backdrop-blur-md rounded-lg px-2 py-1 flex items-center">
                      <img alt="PIX Logo" className="h-3 sm:h-4 w-auto" src={PixFull} />
                    </div>
                  </div>
                  <span className="font-medium text-xs pl-1" style={mutedStyle}>
                    {t(
                      'bank_details.pix_disclaimer',
                      'Tu transacción será procesada de inmediato. Asegúrate de que la llave PIX y el CPF del destinatario sean correctos. Esta transacción no se puede reversar.',
                    )}
                  </span>
                </>
              )
            : (
                <>
                  <div className="flex items-center space-x-2">
                    <Rotate3d className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="font-medium text-xs sm:text-sm">{t('bank_details.network', 'Red:')}</span>
                    <div className="bg-white/70 backdrop-blur-md rounded-lg px-2 py-1 flex items-center">
                      <img alt="BRE-B Logo" className="h-3 sm:h-4 w-auto" src={BreBLogo} />
                    </div>
                  </div>
                  <span className="font-medium text-xs pl-1" style={mutedStyle}>
                    {t(
                      'bank_details.breb_disclaimer',
                      'Tu transacción será procesada de inmediato con BRE-B. Ingresa la clave correcta del destinatario; esta transacción no se puede reversar.',
                    )}
                  </span>
                </>
              )}
        </div>
      </div>

      {/* Continue button: same width as the card above */}
      <Button
        className="mt-4 w-full py-4 cursor-pointer"
        disabled={continueDisabled}
        onClick={onContinue}
      >
        {t('bank_details.continue', 'Continuar')}
      </Button>
    </div>
  )
}
