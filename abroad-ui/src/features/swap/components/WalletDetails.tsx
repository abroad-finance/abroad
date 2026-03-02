import { useTranslate } from '@tolgee/react'
import { motion } from 'framer-motion'
import { RefreshCw, X } from 'lucide-react'
import React from 'react'

import { TransactionListItem } from '../../../api'
import { AB_STYLES } from '../../../shared/constants'
import { cn } from '../../../shared/utils'
import TransactionDetail from '../shared/TransactionDetail'

export interface WalletDetailsProps {
  address: null | string
  copiedAddress: boolean
  formatDate: (dateString: string) => string
  formatDateWithTime: (dateString: string) => string
  getStatusStyle: (status: string) => string
  getStatusText: (status: string) => string
  hasMoreTransactions: boolean
  isLoadingBalance: boolean
  isLoadingMoreTransactions: boolean
  isLoadingTransactions: boolean
  onClose?: () => void
  onCopyAddress: () => Promise<void>
  onDisconnectWallet: () => Promise<void>
  onLoadMoreTransactions: () => void
  onRefreshBalance: () => void
  onRefreshTransactions: () => void
  selectedAssetLabel?: string
  selectedTransaction: null | TransactionListItem
  setSelectedTransaction: (transaction: null | TransactionListItem) => void
  transactionError: null | string
  transactions: TransactionListItem[]
  usdcBalance: string
  usdtBalance: string
}

// Stateless controlled component. All data & handlers provided via props.
const WalletDetails: React.FC<WalletDetailsProps> = ({
  address: _address,
  copiedAddress: _copiedAddress,
  formatDate,
  formatDateWithTime,
  getStatusStyle,
  getStatusText,
  hasMoreTransactions,
  isLoadingBalance: _isLoadingBalance,
  isLoadingMoreTransactions,
  isLoadingTransactions,
  onClose,
  onCopyAddress: _onCopyAddress,
  onDisconnectWallet: _onDisconnectWallet,
  onLoadMoreTransactions,
  onRefreshBalance: _onRefreshBalance,
  onRefreshTransactions,
  selectedAssetLabel: _selectedAssetLabel,
  selectedTransaction,
  setSelectedTransaction,
  transactionError,
  transactions,
  usdcBalance: _usdcBalance,
  usdtBalance: _usdtBalance,
}) => {
  const { t } = useTranslate()

  return (
    <motion.div
      animate={{
        opacity: 1,
        x: 0,
        y: 0,
      }}
      className="w-screen md:w-auto md:mx-0 md:ml-auto md:max-w-md md:flex md:items-center fixed md:relative left-0 md:left-auto top-auto md:top-auto bottom-0 md:bottom-auto h-[80vh] md:h-[95vh]"
      exit={{
        opacity: window.innerWidth >= 768 ? 1 : 0,
        x: window.innerWidth >= 768 ? '100%' : 0,
        y: window.innerWidth >= 768 ? 0 : '100%',
      }}
      initial={{
        opacity: 1,
        x: window.innerWidth >= 768 ? '100%' : 0,
        y: window.innerWidth >= 768 ? 0 : '100%',
      }}
      transition={{
        damping: 30,
        mass: 0.8,
        stiffness: 300,
        type: 'spring',
      }}
    >
      <div
        className="rounded-t-4xl md:rounded-4xl p-4 relative w-full h-full md:h-full md:flex md:flex-col overflow-y-auto backdrop-blur-xl bg-ab-wallet-panel-bg border border-ab-wallet-panel-border shadow-panel"
      >
        {/* Close Button */}
        {onClose && (
          <button
            className={cn('absolute top-4 right-4 p-1.5 rounded-full transition-colors duration-200 cursor-pointer z-10', AB_STYLES.hoverBg)}
            onClick={onClose}
            type="button"
          >
            <X className={cn('w-5 h-5', AB_STYLES.textMuted)} />
          </button>
        )}

        {/* Transaction History */}
        <div className="flex-1 pt-4 md:pt-6">
          {!selectedTransaction && (
            <>
              <div className="flex items-center justify-between mb-4 pr-8">
                <h3 className={cn('font-medium text-lg', AB_STYLES.text)}>{t('wallet_details.transactions.title', 'Historial de Transacciones')}</h3>
                <button
                  className={cn('p-2 rounded-full transition-colors duration-200 disabled:opacity-50', AB_STYLES.hoverBg)}
                  disabled={isLoadingTransactions}
                  onClick={onRefreshTransactions}
                  title={t('wallet_details.actions.refresh_transactions', 'Actualizar transacciones')}
                  type="button"
                >
                  <RefreshCw className={cn(`w-4 h-4 ${isLoadingTransactions ? 'animate-spin' : ''}`, AB_STYLES.text)} />
                </button>
              </div>
              {transactionError && (
                <div className={cn('rounded-xl p-4 mb-4', AB_STYLES.hoverBorder)}>
                  <p className={cn('text-sm', AB_STYLES.text)}>{transactionError}</p>
                </div>
              )}
            </>
          )}

          {isLoadingTransactions
            ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, index) => (
                    <div className={cn('rounded-xl p-4', AB_STYLES.badgeBg)} key={index}>
                      <div className="animate-pulse">
                        <div className="flex justify-between items-center mb-2">
                          <div className={cn('h-4 rounded w-24', AB_STYLES.separatorBg)} />
                          <div className={cn('h-6 rounded w-20', AB_STYLES.separatorBg)} />
                        </div>
                        <div className={cn('h-4 rounded w-32 mb-3', AB_STYLES.separatorBg)} />
                        <div className="flex justify-between items-center">
                          <div className={cn('h-6 rounded w-20', AB_STYLES.separatorBg)} />
                          <div className={cn('h-6 rounded w-24', AB_STYLES.separatorBg)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            : (
                <div className="space-y-3">
                  {selectedTransaction
                    ? (
                        <TransactionDetail
                          formatDate={formatDate}
                          formatDateWithTime={formatDateWithTime}
                          getStatusStyle={getStatusStyle}
                          getStatusText={getStatusText}
                          onBack={() => setSelectedTransaction(null)}
                          onSupport={() => window.open('https://linktr.ee/Abroad.finance', '_blank', 'noopener,noreferrer')}
                          transaction={selectedTransaction}
                        />
                      )
                    : (
                        <>
                          {transactions.map((transaction: TransactionListItem) => (
                            <div
                              className={cn('rounded-xl p-4 transition-colors duration-200 cursor-pointer', AB_STYLES.badgeBg)}
                              key={transaction.id}
                              onClick={() => setSelectedTransaction(transaction)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTransaction(transaction) }}
                              role="button"
                              tabIndex={0}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className={cn('text-sm', AB_STYLES.textMuted)}>{formatDate(transaction.createdAt)}</span>
                                <span className={`text-xs px-2 py-1 rounded-full ${getStatusStyle(transaction.status)}`}>
                                  {getStatusText(transaction.status)}
                                </span>
                              </div>
                              <div className="mb-2">
                                <span className={cn('text-xs', AB_STYLES.textMuted)}>
                                  {t('wallet_details.transactions.to', 'Para:')}
                                  {' '}
                                </span>
                                <span className={cn('font-mono text-sm', AB_STYLES.text)}>{transaction.accountNumber}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                <div className="flex items-center space-x-1">
                                  <img alt="USDC" className="w-4 h-4" src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg" />
                                  <span className={cn('text-xl font-bold', AB_STYLES.text)}>
                                    $
                                    {transaction.quote.sourceAmount.toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-1">
                                  <img
                                    alt={transaction.quote.targetCurrency}
                                    className="w-4 h-4 rounded-full"
                                    src={
                                      transaction.quote.targetCurrency === 'BRL'
                                        ? 'https://hatscripts.github.io/circle-flags/flags/br.svg'
                                        : 'https://hatscripts.github.io/circle-flags/flags/co.svg'
                                    }
                                  />
                                  <span className={cn('text-xl font-bold', AB_STYLES.text)}>
                                    {transaction.quote.targetCurrency === 'BRL' ? 'R$' : '$'}
                                    {transaction.quote.targetAmount.toLocaleString(
                                      transaction.quote.targetCurrency === 'BRL' ? 'pt-BR' : 'es-CO',
                                      { maximumFractionDigits: 2, minimumFractionDigits: 2 },
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}

                          {hasMoreTransactions && (
                            <button
                              className={cn('w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-200 disabled:opacity-50 border border-dashed border-ab-separator', AB_STYLES.textMuted)}
                              disabled={isLoadingMoreTransactions}
                              onClick={onLoadMoreTransactions}
                              type="button"
                            >
                              {isLoadingMoreTransactions && (
                                <RefreshCw className={cn('w-4 h-4 animate-spin', AB_STYLES.textMuted)} />
                              )}
                              <span>
                                {isLoadingMoreTransactions
                                  ? t('wallet_details.transactions.loading_more', 'Cargando más transacciones…')
                                  : t('wallet_details.transactions.load_more', 'Ver más transacciones')}
                              </span>
                            </button>
                          )}
                        </>
                      )}
                </div>
              )}

          {!isLoadingTransactions && transactions.length === 0 && !transactionError && (
            <div className="text-center py-8">
              <div className={cn('rounded-xl p-2.5 mb-4 mx-auto max-w-[60%]', AB_STYLES.badgeBg)}>
                <div className="flex justify-between items-center mb-1.5">
                  <div className={cn('h-3 rounded w-16', AB_STYLES.separatorBg)} />
                  <div className={cn('h-4 rounded w-12', AB_STYLES.separatorBg)} />
                </div>
                <div className={cn('h-3 rounded w-20 mb-2', AB_STYLES.separatorBg)} />
                <div className="flex justify-between items-center">
                  <div className={cn('h-4 rounded w-12', AB_STYLES.separatorBg)} />
                  <div className={cn('h-4 rounded w-16', AB_STYLES.separatorBg)} />
                </div>
              </div>
              <div className={cn('text-sm', AB_STYLES.textMuted)}>
                <div className="font-medium mb-1">{t('wallet_details.empty.no_transactions', 'No hay transacciones aún')}</div>
                <div className="text-xs">{t('wallet_details.empty.hint', 'Cuando hagas tu primera transacción, aparecerá aquí.')}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={cn('text-xs leading-relaxed text-center mt-6 pt-4', AB_STYLES.borderTopSeparator, AB_STYLES.textMuted)}>
          {t('wallet_details.footer.realtime_note', 'Los datos de transacciones se actualizan en tiempo real')}
        </div>
      </div>
    </motion.div>
  )
}

export default WalletDetails
