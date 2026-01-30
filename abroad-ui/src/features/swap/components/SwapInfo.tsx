import { useTranslate } from '@tolgee/react'
import {
    CircleDollarSign,
    Landmark,
    Timer,
} from 'lucide-react'
import React from 'react'
import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'

interface SwapInfoProps {
    isBelowMinimum: boolean
    targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
    transferFeeDisplay: string
}

export function SwapInfo({
    isBelowMinimum,
    targetCurrency,
    transferFeeDisplay,
}: SwapInfoProps) {
    const { t } = useTranslate()

    return (
        <div className="flex-1 flex items-center justify-center w-full">
            <div className="w-full" id="tx-info">
                <div className="flex flex-col space-y-2">
                    {(targetCurrency === TargetCurrency.COP || targetCurrency === TargetCurrency.BRL) && (
                        <div
                            className={`flex items-center space-x-2 ${isBelowMinimum ? 'text-red-600 font-bold' : 'opacity-70'}`}
                            id="min-amount"
                        >
                            <CircleDollarSign className="w-5 h-5" />
                            <span>
                                {targetCurrency === TargetCurrency.COP
                                    ? t('swap.min_amount_cop', 'Mínimo: $5.000 COP')
                                    : t('swap.min_amount_brl', 'Mínimo: R$1,00')}
                            </span>
                        </div>
                    )}
                    <div className="flex items-center space-x-2" id="transfer-fee">
                        <Landmark className="w-5 h-5" />
                        <span>
                            {t('swap.transfer_cost', 'Costo de Transferencia:')}{' '}
                            <b>{transferFeeDisplay}</b>
                        </span>
                    </div>
                    <div className="flex items-center space-x-2" id="time">
                        <Timer className="w-5 h-5" />
                        <span>
                            <b>{t('swap.immediate', 'Inmediato')}</b>
                            {targetCurrency === TargetCurrency.COP && (
                                <span className="opacity-70"> ({t('swap.breb_keys', 'Llaves Bre-B')})</span>
                            )}
                            {targetCurrency === TargetCurrency.BRL && (
                                <span className="opacity-70"> (Pix)</span>
                            )}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
}
