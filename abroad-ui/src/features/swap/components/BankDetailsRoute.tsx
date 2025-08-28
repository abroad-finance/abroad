import { useTranslate } from '@tolgee/react'
import { ArrowLeft, Hash, Loader, Rotate3d } from 'lucide-react'
import React from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import PixFull from '../../../assets/Logos/networks/PixFull.svg'
import { Button } from '../../../shared/components/Button'
import { DropSelector, Option } from '../../../shared/components/DropSelector'

export interface BankDetailsRouteProps {
  accountNumber: string
  bankOpen: boolean
  bankOptions: Option[]
  continueDisabled: boolean
  errorBanks: null | string
  loadingBanks: boolean
  loadingSubmit: boolean
  onAccountNumberChange: (value: string) => void
  onBackClick: () => void
  onContinue: () => void
  onPixKeyChange: (value: string) => void
  onSelectBank: (option: Option) => void
  onTaxIdChange: (value: string) => void
  pixKey: string
  selectedBank: null | Option
  setBankOpen: (open: boolean) => void
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  taxId: string
  textColor?: string
}

export default function BankDetailsRoute({
  accountNumber,
  bankOpen,
  bankOptions,
  continueDisabled,
  errorBanks,
  loadingBanks,
  loadingSubmit,
  onAccountNumberChange,
  onBackClick,
  onContinue,
  onPixKeyChange,
  onSelectBank,
  onTaxIdChange,
  pixKey,
  selectedBank,
  setBankOpen,
  targetAmount,
  targetCurrency,
  taxId,
  textColor = '#356E6A',
}: BankDetailsRouteProps): React.JSX.Element {
  const { t } = useTranslate()

  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div
        className="relative w-[90%] max-w-md min-h-[60vh] h-auto bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center space-y-4"
        id="bg-container"
      >
        {/* Header */}
        <div className="w-full flex items-center space-x-3 mb-2 flex-shrink-0">
          <button
            aria-label={t('bank_details.back_aria', 'Go back')}
            className="hover:text-opacity-80 transition-colors cursor-pointer"
            onClick={onBackClick}
            style={{ color: textColor }}
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div
            className="text-xl sm:text-2xl font-bold flex-grow text-center"
            id="Title"
            style={{ color: textColor }}
          >
            {t('bank_details.title', 'Datos de Transacción')}
          </div>
        </div>

        {/* Inputs */}
        <div className="flex-1 flex flex-col items-center justify-center w-full space-y-3 py-2">
          {targetCurrency === TargetCurrency.BRL
            ? (
                <>
                  {/* PIX Key */}
                  <div className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3" id="pix-key-input">
                    <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: textColor }} />
                    <input
                      className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                      inputMode="text"
                      onChange={e => onPixKeyChange(e.target.value)}
                      placeholder={t('bank_details.pix_key_placeholder', 'PIX Key')}
                      style={{ color: textColor }}
                      type="text"
                      value={pixKey}
                    />
                  </div>
                  {/* CPF */}
                  <div className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3" id="cpf-input">
                    <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: textColor }} />
                    <input
                      className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                      inputMode="numeric"
                      onChange={e => onTaxIdChange(e.target.value)}
                      pattern="[0-9]*"
                      placeholder={t('bank_details.cpf_placeholder', 'CPF')}
                      style={{ color: textColor }}
                      type="text"
                      value={taxId}
                    />
                  </div>
                </>
              )
            : (
                <>
                  {/* Transfiya number */}
                  <div
                    className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3"
                    id="bank-account-input"
                  >
                    <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: textColor }} />
                    <input
                      className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                      inputMode="numeric"
                      onChange={e => onAccountNumberChange(e.target.value)}
                      pattern="[0-9]*"
                      placeholder={t('bank_details.transfiya_placeholder', 'Número Transfiya')}
                      style={{ color: textColor }}
                      type="text"
                      value={accountNumber}
                    />
                  </div>

                  {/* Bank selector */}
                  <div
                    className="w-full bg-white/60 backdrop-blur-xl rounded-2xl flex-shrink-0 relative z-50"
                    id="bank-selector"
                  >
                    {loadingBanks && (
                      <div className="p-6 flex items-center space-x-3">
                        <Loader className="animate-spin w-4 h-4 sm:w-5 sm:h-5" style={{ color: textColor }} />
                      </div>
                    )}
                    {errorBanks && (
                      <div className="p-6 flex items-center space-x-3">
                        <p className="text-red-500 text-xs sm:text-sm">{errorBanks}</p>
                      </div>
                    )}
                    {!loadingBanks && !errorBanks && bankOptions.length === 0 && (
                      <div className="p-6 flex items-center space-x-3">
                        <p className="text-[#356E6A]/70 text-xs sm:text-sm">
                          {t('bank_details.no_banks', 'No hay bancos disponibles.')}
                        </p>
                      </div>
                    )}
                    {!loadingBanks && !errorBanks && bankOptions.length > 0 && (
                      <div className="p-6 flex items-center space-x-3 w-full">
                        <div className="flex-1">
                          <DropSelector
                            disabled={loadingBanks || errorBanks !== null}
                            isOpen={bankOpen}
                            onSelectOption={onSelectBank}
                            options={bankOptions}
                            placeholder={t('bank_details.bank_placeholder', 'Banco')}
                            placeholderIcons={[
                              'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Nequi_Badge.webp',
                              'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Daviplata_Badge.png',
                              'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancolombia_Badge.png',
                            ]}
                            selectedOption={selectedBank}
                            setIsOpen={setBankOpen}
                            textColor={textColor}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

          {/* Amount info */}
          <div
            className="relative font-medium w-full flex items-center space-x-1"
            id="tx-info"
            style={{ color: textColor }}
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
          style={{ color: textColor }}
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
                  <span className="font-medium text-xs pl-1" style={{ color: textColor }}>
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
                      <img
                        alt="Transfiya Logo"
                        className="h-3 sm:h-4 w-auto"
                        src="https://vectorseek.com/wp-content/uploads/2023/11/Transfiya-Logo-Vector.svg-.png"
                      />
                    </div>
                  </div>
                  <span className="font-medium text-xs pl-1" style={{ color: textColor }}>
                    {t(
                      'bank_details.transfiya_disclaimer',
                      'Tu transacción será procesada de inmediato y llegará instantáneamente. Ten presente que el receptor debe tener activado Transfiya en el banco indicado.',
                    )}
                  </span>
                </>
              )}
        </div>
      </div>

      {/* Continue button */}
      <Button
        className="mt-4 w-[90%] max-w-md py-4 cursor-pointer"
        disabled={continueDisabled}
        onClick={onContinue}
      >
        {loadingSubmit
          ? (
              <Loader className="animate-spin w-4 h-4 sm:w-5 sm:h-5" />
            )
          : (
              t('bank_details.continue', 'Continuar')
            )}
      </Button>
    </div>
  )
}
