import { useTranslate } from '@tolgee/react'
import React from 'react'

import { Button } from '../../../shared/components/Button'

export interface ConfirmQrProps {
  onConfirm: () => void
  onEdit: () => void
  pixKey?: string
  sourceAmount?: string
  targetAmount?: string
  taxId?: string
}

const ConfirmQr: React.FC<ConfirmQrProps> = ({ onConfirm, onEdit, pixKey, sourceAmount, targetAmount, taxId }) => {
  const { t } = useTranslate()
  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">

      <div className="w-[98%] max-w-md min-h-[60vh] h-auto bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-around space-y-4 text-abroad-dark md:text-white">
        <h2 className="text-2xl font-semibold mb-4">{t('confirm_qr.title', 'Confirmar detalles del pago')}</h2>

        <div className="flex items-center gap-3 mb-4">
          <img
            alt="USDC Token"
            className="w-12 h-12"
            src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
          />

          <span className="text-xl font-semibold text-abroad-dark md:text-white">&gt;&gt;</span>

          <img
            alt="Brazil flag"
            className="w-12 h-12 rounded-full"
            src="https://hatscripts.github.io/circle-flags/flags/br.svg"
          />
        </div>

        <div className="space-y-3 text-sm ">
          <div>
            <div className="text-xl ">{t('confirm_qr.amount', 'Cantidad')}</div>
            <div className="text-2xl font-medium">{targetAmount ? `R$${targetAmount}` : '—'}</div>
          </div>

          <div>
            <div className="text-xl ">{t('confirm_qr.asset_usdc', 'USDC')}</div>
            <div className="text-2xl font-medium">{sourceAmount ? `$${sourceAmount}` : '—'}</div>
          </div>

          <div>
            <div className="text-xl ">{t('confirm_qr.pix_key', 'PIX key')}</div>
            <div className="text-2xl font-medium break-words">{pixKey ? pixKey : '—'}</div>
          </div>

          <div>
            <div className="text-xl ">{t('confirm_qr.tax_id', 'Tax ID')}</div>
            <div className="text-2xl font-medium">{taxId ? taxId : '-'}</div>
          </div>
        </div>

      </div>
      <div className="mt-6 flex gap-3 w-full h-14">
        <button
          className="flex-1 bg-transparent text-[#356E6A] md:text-white border border-[#356E6A] rounded-lg hover:!text-abroad-light"
          onClick={onEdit}
          type="button"
        >
          {t('onfirm_qr.edit', 'Edit')}
        </button>
        <Button
          className="flex-1"
          onClick={onConfirm}
          type="button"
        >
          {t('confirm_qr.confirm', 'Confirm')}
        </Button>
      </div>
    </div>
  )
}

export default ConfirmQr
