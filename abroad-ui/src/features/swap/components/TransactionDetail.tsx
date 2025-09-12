import React, { useState } from 'react'
import { useTranslate } from '@tolgee/react'
import { PaginatedTransactionListTransactionsItem } from '../../../api'
import { formatMoney } from '../../../shared/utils'
import { ShieldQuestionMark } from 'lucide-react'

export interface TransactionDetailProps {
  transaction: PaginatedTransactionListTransactionsItem
  onBack: () => void
  formatDate: (dateString: string) => string
  getStatusStyle: (status: string) => string
  getStatusText: (status: string) => string
  onSupport: () => void
}

const TransactionDetail: React.FC<TransactionDetailProps> = ({
  transaction,
  onBack,
  formatDate,
  getStatusStyle,
  getStatusText,
  onSupport
}) => {
  const { t } = useTranslate()
  const [showRawDetails, setShowRawDetails] = useState(false)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-lg font-medium text-gray-800">{t('wallet_details.transactions.detail_title', 'Detalle de transacción')}</h4>
        <div className="flex items-center gap-3">
          <button
            className="text-sm hover:underline hover:cursor-pointer"
            onClick={onSupport}
            aria-label={t('wallet_details.actions.support', 'Support')}
          >
            <ShieldQuestionMark className="w-5 h-5 text-abroad-dark" />
          </button>

          <button
            className="text-sm text-blue-600 hover:underline hover:cursor-pointer"
            onClick={onBack}
          >
            {t('wallet_details.actions.back_to_list', 'Volver')}
          </button>
        </div>
      </div>

      <div className="mb-2">
        <div className="text-xs text-gray-500">{t('wallet_details.transactions.date', 'Fecha')}</div>
        <div className="text-sm text-gray-700">{formatDate(transaction.createdAt)}</div>
      </div>

      <div className="mb-2">
        <div className="text-xs text-gray-500">{t('wallet_details.transactions.status', 'Estado')}</div>
        <div className={`inline-block mt-1 text-xs px-2 py-1 rounded-full ${getStatusStyle(transaction.status)}`}>
          {getStatusText(transaction.status)}
        </div>
      </div>

      <div className="mb-2">
        <div className="text-xs text-gray-500">{t('wallet_details.transactions.to', 'Para')}</div>
        <div className="text-sm font-mono text-gray-700">{transaction.accountNumber}</div>
      </div>

      <div className="mb-2 flex justify-between items-center">
        <div>
          <div className="text-xs text-gray-500">{t('wallet_details.transactions.from_amount', 'Monto USDC')}</div>
          <div className="text-lg font-bold">${transaction.quote.sourceAmount.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">{t('wallet_details.transactions.to_amount', 'Monto destino')}</div>
          <div className="text-lg font-bold">
            {formatMoney(transaction.quote.targetCurrency, transaction.quote.targetAmount.toString())}
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        <div className="flex items-center justify-between mb-1">
          <div className="font-medium">{t('wallet_details.transactions.raw', 'Detalles')}</div>
          <button
            className="text-sm text-blue-600 hover:underline hover:cursor-pointer"
            onClick={() => setShowRawDetails(prev => !prev)}
            aria-expanded={showRawDetails}
            aria-controls="transaction-raw-details"
          >
            {showRawDetails ? t('wallet_details.actions.hide_details', 'Ocultar detalles') : t('wallet_details.actions.show_details', 'Mostrar detalles')}
          </button>
        </div>
        {showRawDetails && (
          <pre id="transaction-raw-details" className="text-xs text-gray-700 bg-gray-50 p-2 rounded overflow-auto max-h-40">{JSON.stringify(transaction, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}

export default TransactionDetail
