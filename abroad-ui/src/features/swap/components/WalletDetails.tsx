import { useTranslate } from '@tolgee/react'
import { motion } from 'framer-motion'
import {
  Copy, ExternalLink, RefreshCw, X,
} from 'lucide-react'
import React from 'react'

import { PaginatedTransactionListTransactionsItem } from '../../../api'
import TransactionDetail from './TransactionDetail'

export interface WalletDetailsProps {
  address: null | string
  copiedAddress: boolean
  formatDate: (dateString: string) => string
  getStatusStyle: (status: string) => string
  getStatusText: (status: string) => string
  isLoadingBalance: boolean
  isLoadingTransactions: boolean
  onClose?: () => void
  onCopyAddress: () => Promise<void>
  onDisconnectWallet: () => Promise<void>
  onRefreshBalance: () => void
  onRefreshTransactions: () => void
  transactionError: null | string
  transactions: PaginatedTransactionListTransactionsItem[]
  usdcBalance: string, 
  selectedTransaction: PaginatedTransactionListTransactionsItem | null,
  setSelectedTransaction: (transaction: PaginatedTransactionListTransactionsItem | null) => void
}

// Stateless controlled component. All data & handlers provided via props.
const WalletDetails: React.FC<WalletDetailsProps> = ({
  address,
  copiedAddress,
  formatDate,
  getStatusStyle,
  getStatusText,
  isLoadingBalance,
  isLoadingTransactions,
  onClose,
  onCopyAddress,
  onDisconnectWallet,
  onRefreshBalance,
  onRefreshTransactions,
  transactionError,
  transactions,
  usdcBalance,
  selectedTransaction,
  setSelectedTransaction,
}) => {
  const { t } = useTranslate()

  const formatWalletAddress = (addr: null | string) => {
    if (!addr) return t('wallet_details.not_connected', 'No conectado')
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

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
      <div className="bg-white rounded-t-4xl md:rounded-4xl shadow-lg border border-gray-200 p-4 relative w-full h-full md:h-full md:flex md:flex-col overflow-y-auto">
        {/* Close Button */}
        {onClose && (
          <button
            className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 transition-colors duration-200 cursor-pointer z-10"
            onClick={onClose}
          >
            <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
          </button>
        )}

        {/* Header */}
        <div className="mb-6 pr-8 text-center mt-2 md:mt-4">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            {t('wallet_details.header.title', 'Tu Cuenta')}
          </h2>
          <p className="text-md text-gray-600">
            {t('wallet_details.header.subtitle', 'Gestiona tu billetera y consulta el historial de transacciones')}
          </p>
        </div>

        {/* Wallet Address & Balance Card */}
        <div
          className="border border-gray-200 rounded-xl p-6 py-8 mb-6 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(https://static.vecteezy.com/system/resources/previews/026/493/927/non_2x/abstract-gradient-dark-green-liquid-wave-background-free-vector.jpg)' }}
        >
          {/* Wallet Address Section */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-white font-mono text-sm break-all">{formatWalletAddress(address)}</span>
            <div className="flex space-x-2">
              <button
                className="p-1 hover:bg-red-100 hover:bg-opacity-20 rounded transition-colors duration-200"
                onClick={onDisconnectWallet}
                title={t('wallet_details.actions.disconnect', 'Desconectar billetera')}
              >
                <svg className="w-4 h-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
              </button>
              <button
                className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors duration-200"
                onClick={onCopyAddress}
                title={t('wallet_details.actions.copy_address', 'Copiar dirección')}
              >
                <Copy className="w-4 h-4 text-white" />
              </button>
              <button
                className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors duration-200"
                onClick={() => window.open(`https://stellar.expert/explorer/public/account/${address}`, '_blank')}
                title={t('wallet_details.actions.view_explorer', 'Ver en explorador')}
              >
                <ExternalLink className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
          {copiedAddress && (
            <div className="text-green-300 text-xs mb-4">{t('wallet_details.toast.copied', '¡Dirección copiada!')}</div>
          )}

          {/* Balance Section */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img
                alt="USDC"
                className="w-5 h-5"
                src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
              />
              {isLoadingBalance
                ? (
                    <div className="w-32 h-9 bg-white/20 rounded animate-pulse"></div>
                  )
                : (
                    <span className="text-white font-bold text-4xl">
                      $
                      {usdcBalance}
                    </span>
                  )}
            </div>
            {/* Refresh Balance Button */}
            <button
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition-colors duration-200 disabled:opacity-50"
              disabled={isLoadingBalance}
              onClick={onRefreshBalance}
              title={t('wallet_details.actions.refresh_balance', 'Actualizar balance')}
            >
              <RefreshCw className={`w-4 h-4 text-white ${isLoadingBalance ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Transaction History */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-800 font-medium text-lg">{t('wallet_details.transactions.title', 'Historial de Transacciones')}</h3>
            <button
              className="p-2 hover:bg-gray-100 rounded-full transition-colors duration-200 disabled:opacity-50"
              disabled={isLoadingTransactions}
              onClick={onRefreshTransactions}
              title={t('wallet_details.actions.refresh_transactions', 'Actualizar transacciones')}
            >
              <RefreshCw className={`w-4 h-4 text-gray-600 ${isLoadingTransactions ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {transactionError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <p className="text-red-700 text-sm">{transactionError}</p>
            </div>
          )}

          {isLoadingTransactions
            ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, index) => (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4" key={index}>
                      <div className="animate-pulse">
                        <div className="flex justify-between items-center mb-2">
                          <div className="h-4 bg-gray-200 rounded w-24"></div>
                          <div className="h-6 bg-gray-200 rounded w-20"></div>
                        </div>
                        <div className="h-4 bg-gray-200 rounded w-32 mb-3"></div>
                        <div className="flex justify-between items-center">
                          <div className="h-6 bg-gray-200 rounded w-20"></div>
                          <div className="h-6 bg-gray-200 rounded w-24"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
                : (
                  <div className="space-y-3">
                    {selectedTransaction ? (
                      <TransactionDetail
                        transaction={selectedTransaction}
                        onBack={() => setSelectedTransaction(null)}
                        formatDate={formatDate}
                        getStatusStyle={getStatusStyle}
                        getStatusText={getStatusText}
                        onSupport={() => window.open('https://linktr.ee/Abroad.finance', '_blank', 'noopener,noreferrer')}
                      />
                    ) : (
                      transactions.map((transaction: PaginatedTransactionListTransactionsItem) => (
                        <div
                          className="bg-gray-50 border border-gray-200 rounded-xl p-4 hover:bg-gray-100 transition-colors duration-200 cursor-pointer"
                          key={transaction.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedTransaction(transaction)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTransaction(transaction) }}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <span className="text-gray-600 text-sm">{formatDate(transaction.createdAt)}</span>
                            </div>
                            <span className={`text-xs px-2 py-1 rounded-full ${getStatusStyle(transaction.status)}`}>
                              {getStatusText(transaction.status)}
                            </span>
                          </div>

                          <div className="mb-2">
                            <span className="text-gray-500 text-xs">{t('wallet_details.transactions.to', 'Para:')}</span>
                            <span className="text-gray-700 font-mono text-sm">
                              {transaction.accountNumber}
                            </span>
                          </div>

                          <div className="flex justify-between items-center">
                            <div className="flex items-center space-x-1">
                              <img
                                alt="USDC"
                                className="w-4 h-4"
                                src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                              />
                              <span className="text-gray-700 text-xl font-bold">
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
                              <span className="text-gray-700 text-xl font-bold">
                                {transaction.quote.targetCurrency === 'BRL' ? 'R$' : '$'}
                                {transaction.quote.targetAmount.toLocaleString(
                                  transaction.quote.targetCurrency === 'BRL' ? 'pt-BR' : 'es-CO',
                                  {
                                    maximumFractionDigits: 2,
                                    minimumFractionDigits: 2,
                                  },
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

          {!isLoadingTransactions && transactions.length === 0 && !transactionError && (
            <div className="text-center py-8">
              {/* Skeleton card - 60% smaller than regular transaction cards */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 mb-4 mx-auto max-w-[60%] relative">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="h-3 bg-gray-200 rounded w-16"></div>
                    <div className="h-4 bg-gray-200 rounded w-12"></div>
                  </div>
                  <div className="h-3 bg-gray-200 rounded w-20 mb-2"></div>
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-gray-200 rounded w-12"></div>
                    <div className="h-4 bg-gray-200 rounded w-16"></div>
                  </div>
                </div>
                {/* Alert sign overlay - top right corner */}
                <div className="absolute -top-2 -right-2">
                  <div className="bg-orange-200 text-white rounded-full w-5 h-5 flex items-center justify-center text-sm font-bold">
                    !
                  </div>
                </div>
              </div>
              <div className="text-gray-400 text-sm">
                <div className="font-medium mb-1">{t('wallet_details.empty.no_transactions', 'No hay transacciones aún')}</div>
                <div className="text-xs">{t('wallet_details.empty.hint', 'Cuando hagas tu primera transacción, aparecerá aquí.')}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-xs text-gray-500 leading-relaxed text-center mt-6 pt-4 border-t border-gray-200">
          {t('wallet_details.footer.realtime_note', 'Los datos de transacciones se actualizan en tiempo real')}
        </div>
      </div>
    </motion.div>
  )
}

export default WalletDetails
