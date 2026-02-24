import { useTranslate } from '@tolgee/react'
import { motion } from 'framer-motion'
import {
  Copy, ExternalLink, RefreshCw, X,
} from 'lucide-react'
import React from 'react'

import { TransactionListItem } from '../../../api'
import { AB_STYLES } from '../../../shared/constants'
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
  address,
  copiedAddress,
  formatDate,
  formatDateWithTime,
  getStatusStyle,
  getStatusText,
  hasMoreTransactions,
  isLoadingBalance,
  isLoadingMoreTransactions,
  isLoadingTransactions,
  onClose,
  onCopyAddress,
  onDisconnectWallet,
  onLoadMoreTransactions,
  onRefreshBalance,
  onRefreshTransactions,
  selectedAssetLabel,
  selectedTransaction,
  setSelectedTransaction,
  transactionError,
  transactions,
  usdcBalance,
  usdtBalance,
}) => {
  const { t } = useTranslate()
  const sourceBalance = selectedAssetLabel === 'USDT' ? usdtBalance : usdcBalance

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
      <div
        className="rounded-t-4xl md:rounded-4xl p-4 relative w-full h-full md:h-full md:flex md:flex-col overflow-y-auto backdrop-blur-xl"
        style={{ background: 'var(--ab-wallet-panel-bg)', border: '1px solid var(--ab-wallet-panel-border)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.08)' }}
      >
        {/* Close Button */}
        {onClose && (
          <button
            className="absolute top-4 right-4 p-1.5 rounded-full transition-colors duration-200 cursor-pointer z-10"
            onClick={onClose}
            style={AB_STYLES.hoverBg}
            type="button"
          >
            <X className="w-5 h-5" style={AB_STYLES.textMuted} />
          </button>
        )}

        {/* Header */}
        <div className="mb-6 pr-8 text-center mt-2 md:mt-4">
          <h2 className="text-2xl font-semibold mb-2" style={AB_STYLES.text}>
            {t('wallet_details.header.title', 'Tu Cuenta')}
          </h2>
          <p className="text-md" style={AB_STYLES.textMuted}>
            {t('wallet_details.header.subtitle', 'Gestiona tu billetera y consulta el historial de transacciones')}
          </p>
        </div>

        {/* Wallet Address & Balance Card - glass */}
        <div
          className="rounded-2xl p-6 py-8 mb-6 backdrop-blur-md"
          style={AB_STYLES.badgeBg}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-sm break-all" style={AB_STYLES.text}>{formatWalletAddress(address)}</span>
            <div className="flex space-x-2">
              <button
                className="p-1.5 rounded-lg transition-colors duration-200"
                onClick={onDisconnectWallet}
                style={AB_STYLES.hoverBg}
                title={t('wallet_details.actions.disconnect', 'Desconectar billetera')}
                type="button"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" style={AB_STYLES.textMuted} viewBox="0 0 24 24">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
              </button>
              <button
                className="p-1.5 rounded-lg transition-colors duration-200"
                onClick={onCopyAddress}
                style={AB_STYLES.hoverBg}
                title={t('wallet_details.actions.copy_address', 'Copiar dirección')}
                type="button"
              >
                <Copy className="w-4 h-4" style={AB_STYLES.text} />
              </button>
              <button
                className="p-1.5 rounded-lg transition-colors duration-200"
                onClick={() => window.open(`https://stellar.expert/explorer/public/account/${address}`, '_blank')}
                style={AB_STYLES.hoverBg}
                title={t('wallet_details.actions.view_explorer', 'Ver en explorador')}
                type="button"
              >
                <ExternalLink className="w-4 h-4" style={AB_STYLES.text} />
              </button>
            </div>
          </div>
          {copiedAddress && (
            <div className="text-xs mb-4" style={AB_STYLES.btnColor}>{t('wallet_details.toast.copied', '¡Dirección copiada!')}</div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img
                alt="USDC"
                className="w-5 h-5"
                src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
              />
              {isLoadingBalance
                ? (
                    <div className="h-9 w-32 rounded-lg animate-pulse" style={AB_STYLES.separatorBg} />
                  )
                : (
                    <span className="font-bold text-4xl" style={AB_STYLES.text}>
                      $
                      {sourceBalance}
                    </span>
                  )}
            </div>
            <button
              className="p-2 rounded-full transition-colors duration-200 disabled:opacity-50"
              disabled={isLoadingBalance}
              onClick={onRefreshBalance}
              style={AB_STYLES.hoverBg}
              title={t('wallet_details.actions.refresh_balance', 'Actualizar balance')}
              type="button"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingBalance ? 'animate-spin' : ''}`} style={AB_STYLES.text} />
            </button>
          </div>
        </div>

        {/* Transaction History */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-lg" style={AB_STYLES.text}>{t('wallet_details.transactions.title', 'Historial de Transacciones')}</h3>
            <button
              className="p-2 rounded-full transition-colors duration-200 disabled:opacity-50"
              disabled={isLoadingTransactions}
              onClick={onRefreshTransactions}
              style={AB_STYLES.hoverBg}
              title={t('wallet_details.actions.refresh_transactions', 'Actualizar transacciones')}
              type="button"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingTransactions ? 'animate-spin' : ''}`} style={AB_STYLES.text} />
            </button>
          </div>

          {transactionError && (
            <div className="rounded-xl p-4 mb-4" style={AB_STYLES.hoverBorder}>
              <p className="text-sm" style={AB_STYLES.text}>{transactionError}</p>
            </div>
          )}

          {isLoadingTransactions
            ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, index) => (
                    <div className="rounded-xl p-4" key={index} style={AB_STYLES.badgeBg}>
                      <div className="animate-pulse">
                        <div className="flex justify-between items-center mb-2">
                          <div className="h-4 rounded w-24" style={AB_STYLES.separatorBg} />
                          <div className="h-6 rounded w-20" style={AB_STYLES.separatorBg} />
                        </div>
                        <div className="h-4 rounded w-32 mb-3" style={AB_STYLES.separatorBg} />
                        <div className="flex justify-between items-center">
                          <div className="h-6 rounded w-20" style={AB_STYLES.separatorBg} />
                          <div className="h-6 rounded w-24" style={AB_STYLES.separatorBg} />
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
                              className="rounded-xl p-4 transition-colors duration-200 cursor-pointer"
                              key={transaction.id}
                              onClick={() => setSelectedTransaction(transaction)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTransaction(transaction) }}
                              role="button"
                              style={AB_STYLES.badgeBg}
                              tabIndex={0}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm" style={AB_STYLES.textMuted}>{formatDate(transaction.createdAt)}</span>
                                <span className={`text-xs px-2 py-1 rounded-full ${getStatusStyle(transaction.status)}`}>
                                  {getStatusText(transaction.status)}
                                </span>
                              </div>
                              <div className="mb-2">
                                <span className="text-xs" style={AB_STYLES.textMuted}>
                                  {t('wallet_details.transactions.to', 'Para:')}
                                  {' '}
                                </span>
                                <span className="font-mono text-sm" style={AB_STYLES.text}>{transaction.accountNumber}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                <div className="flex items-center space-x-1">
                                  <img alt="USDC" className="w-4 h-4" src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg" />
                                  <span className="text-xl font-bold" style={AB_STYLES.text}>
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
                                  <span className="text-xl font-bold" style={AB_STYLES.text}>
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
                              className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-200 disabled:opacity-50"
                              disabled={isLoadingMoreTransactions}
                              onClick={onLoadMoreTransactions}
                              style={{ border: '1px dashed var(--ab-separator)', color: 'var(--ab-text-muted)' }}
                              type="button"
                            >
                              {isLoadingMoreTransactions && (
                                <RefreshCw className="w-4 h-4 animate-spin" style={AB_STYLES.textMuted} />
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
              <div className="rounded-xl p-2.5 mb-4 mx-auto max-w-[60%]" style={AB_STYLES.badgeBg}>
                <div className="flex justify-between items-center mb-1.5">
                  <div className="h-3 rounded w-16" style={AB_STYLES.separatorBg} />
                  <div className="h-4 rounded w-12" style={AB_STYLES.separatorBg} />
                </div>
                <div className="h-3 rounded w-20 mb-2" style={AB_STYLES.separatorBg} />
                <div className="flex justify-between items-center">
                  <div className="h-4 rounded w-12" style={AB_STYLES.separatorBg} />
                  <div className="h-4 rounded w-16" style={AB_STYLES.separatorBg} />
                </div>
              </div>
              <div className="text-sm" style={AB_STYLES.textMuted}>
                <div className="font-medium mb-1">{t('wallet_details.empty.no_transactions', 'No hay transacciones aún')}</div>
                <div className="text-xs">{t('wallet_details.empty.hint', 'Cuando hagas tu primera transacción, aparecerá aquí.')}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-xs leading-relaxed text-center mt-6 pt-4" style={{ ...AB_STYLES.borderTopSeparator, ...AB_STYLES.textMuted }}>
          {t('wallet_details.footer.realtime_note', 'Los datos de transacciones se actualizan en tiempo real')}
        </div>
      </div>
    </motion.div>
  )
}

export default WalletDetails
