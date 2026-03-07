import { useTranslate } from '@tolgee/react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import type { ApiClientResponse } from '../../../api/customClient'

import {
  listPartnerTransactions,
  type ListPartnerTransactions400,
  type listPartnerTransactionsResponse,
  TransactionListItem,
} from '../../../api'
import { useWebSocketSubscription } from '../../../contexts/WebSocketContext'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'
import { WalletDetailsProps } from '../components/WalletDetails'
import { useStablecoinBalances } from './useStablecoinBalances'

const DEFAULT_TRANSACTIONS_PAGE_SIZE = 10

type ListTransactionsResult = ApiClientResponse<listPartnerTransactionsResponse, ListPartnerTransactions400>

interface PaginationState {
  currentPage: number
  hasMore: boolean
  total: number
}

interface Params { onClose?: () => void }
// Transaction type
type Transaction = TransactionListItem

// Hook encapsulating all stateful logic from WalletDetails component.
export function useWalletDetails(params: Params = {}): WalletDetailsProps {
  const { onClose } = params
  const { t } = useTranslate()
  const { wallet, walletAuthentication } = useWalletAuth()

  const [copiedAddress, setCopiedAddress] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false)
  const [isLoadingMoreTransactions, setIsLoadingMoreTransactions] = useState(false)
  const [transactionError, setTransactionError] = useState<null | string>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<null | TransactionListItem>(null)
  const transactionsRef = useRef<Transaction[]>([])
  const pageSizeRef = useRef<number>(DEFAULT_TRANSACTIONS_PAGE_SIZE)
  const transactionsAbortRef = useRef<AbortController | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({
    currentPage: 0,
    hasMore: false,
    total: 0,
  })
  const stablecoinBalances = useStablecoinBalances({
    address: wallet?.address,
    chainId: wallet?.chainId,
  })

  useEffect(() => {
    transactionsRef.current = transactions
  }, [transactions])

  useEffect(() => {
    return () => {
      transactionsAbortRef.current?.abort()
    }
  }, [])

  const loadTransactions = useCallback(async ({ append, page }: { append: boolean, page: number }) => {
    if (!walletAuthentication?.jwtToken) {
      setTransactionError(t('wallet_details.error.no_token', 'No authentication token available'))
      return
    }

    const userId = wallet?.address && wallet?.chainId ? `${wallet.chainId}:${wallet.address}` : null
    if (!userId) {
      setTransactionError(t('wallet_details.error.no_address', 'No wallet address connected'))
      return
    }

    const setLoadingState = append ? setIsLoadingMoreTransactions : setIsLoadingTransactions
    transactionsAbortRef.current?.abort()
    const abortController = new AbortController()
    transactionsAbortRef.current = abortController

    try {
      setLoadingState(true)
      setTransactionError(null)

      const response = await listPartnerTransactions({
        externalUserId: userId,
        page,
        pageSize: pageSizeRef.current,
      }, { signal: abortController.signal }) as ListTransactionsResult

      if (abortController.signal.aborted) return

      if (response.status !== 200) {
        const fallback = t('wallet_details.error.fetch_failed', 'Failed to fetch transactions')
        const reason = response.data && typeof response.data === 'object' && 'reason' in response.data
          ? (response.data as { reason?: string }).reason
          : null
        setTransactionError(reason || response.error?.message || fallback)
        return
      }

      const { pageSize, total, transactions: pageTransactions } = response.data

      if (pageSize && pageSize > 0) pageSizeRef.current = pageSize

      const nextTransactions = Array.isArray(pageTransactions) ? pageTransactions : []
      const aggregatedTransactions = append
        ? [...transactionsRef.current, ...nextTransactions]
        : nextTransactions

      transactionsRef.current = aggregatedTransactions
      setTransactions(aggregatedTransactions)

      if (!append) setSelectedTransaction(null)

      const safeTotal = typeof total === 'number' ? total : 0
      const effectivePageSize = pageSizeRef.current || DEFAULT_TRANSACTIONS_PAGE_SIZE
      const hasMore = nextTransactions.length > 0 && (
        safeTotal > 0
          ? aggregatedTransactions.length < safeTotal
          : nextTransactions.length === effectivePageSize
      )

      setPagination({
        currentPage: page,
        hasMore,
        total: safeTotal,
      })
    }
    catch (err) {
      if (abortController.signal.aborted) return
      setTransactionError(err instanceof Error ? err.message : t('wallet_details.error.loading', 'Error loading transactions'))
    }
    finally {
      if (!abortController.signal.aborted) {
        setLoadingState(false)
      }
      transactionsAbortRef.current = null
    }
  }, [
    walletAuthentication?.jwtToken,
    t,
    wallet?.address,
    wallet?.chainId,
  ])

  // Effects
  useEffect(() => {
    if (wallet?.address && wallet?.chainId && walletAuthentication?.jwtToken) {
      loadTransactions({ append: false, page: 1 })
    }
  }, [
    wallet?.address,
    wallet?.chainId,
    walletAuthentication?.jwtToken,
    loadTransactions,
  ])

  // Subscribe to websocket notifications to refresh transactions and balance
  const refreshFromEvent = useCallback(() => {
    if (!wallet?.address || !wallet?.chainId) return
    if (walletAuthentication?.jwtToken) {
      void loadTransactions({ append: false, page: 1 })
    }
    void stablecoinBalances.refresh()
  }, [
    wallet?.address,
    wallet?.chainId,
    loadTransactions,
    stablecoinBalances.refresh,
    walletAuthentication?.jwtToken,
  ])

  useWebSocketSubscription('transaction.created', refreshFromEvent)
  useWebSocketSubscription('transaction.updated', refreshFromEvent)
  useWebSocketSubscription('connect_error', (err) => {
    setTransactionError(err.message || 'WS connection error')
  })

  // Handlers exposed to component
  const onRefreshBalance = useCallback(() => {
    if (!wallet?.address || !wallet?.chainId || stablecoinBalances.isLoading) return
    void stablecoinBalances.refresh()
  }, [
    wallet?.address,
    wallet?.chainId,
    stablecoinBalances.isLoading,
    stablecoinBalances.refresh,
  ])

  const onRefreshTransactions = useCallback(() => {
    if (!walletAuthentication?.jwtToken || !wallet?.address || !wallet?.chainId) return
    if (isLoadingTransactions || isLoadingMoreTransactions) return
    loadTransactions({ append: false, page: 1 })
  }, [
    walletAuthentication?.jwtToken,
    wallet?.address,
    wallet?.chainId,
    isLoadingTransactions,
    isLoadingMoreTransactions,
    loadTransactions,
  ])

  const onLoadMoreTransactions = useCallback(() => {
    if (!walletAuthentication?.jwtToken || !wallet?.address || !wallet?.chainId) return
    if (!pagination.hasMore || isLoadingTransactions || isLoadingMoreTransactions) return
    loadTransactions({ append: true, page: pagination.currentPage + 1 })
  }, [
    walletAuthentication?.jwtToken,
    wallet?.address,
    wallet?.chainId,
    pagination.hasMore,
    pagination.currentPage,
    isLoadingTransactions,
    isLoadingMoreTransactions,
    loadTransactions,
  ])

  const onCopyAddress = useCallback(async () => {
    try {
      if (wallet?.address) {
        await navigator.clipboard.writeText(wallet.address)
        setCopiedAddress(true)
        setTimeout(() => setCopiedAddress(false), 2000)
      }
    }
    catch { /* swallow */ }
  }, [wallet?.address])

  const onDisconnectWallet = useCallback(async () => {
    try {
      await wallet?.disconnect()
      onClose?.()
    }
    catch { /* swallow */ }
  }, [wallet, onClose])

  const getStatusStyle = useCallback((status: string) => {
    switch (status) {
      case 'AWAITING_PAYMENT':
      case 'PROCESSING_PAYMENT': return 'bg-blue-100 text-blue-700'
      case 'PAYMENT_COMPLETED': return 'bg-green-100 text-green-700'
      case 'PAYMENT_EXPIRED':
      case 'PAYMENT_FAILED':
      case 'WRONG_AMOUNT': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }, [])

  const getStatusText = useCallback((status: string) => {
    switch (status) {
      case 'AWAITING_PAYMENT': return t('wallet_details.status.awaiting_payment', 'Esperando Pago')
      case 'PAYMENT_COMPLETED': return t('wallet_details.status.completed', 'Completado')
      case 'PAYMENT_EXPIRED': return t('wallet_details.status.expired', 'Pago Expirado')
      case 'PAYMENT_FAILED': return t('wallet_details.status.failed', 'Pago Fallido')
      case 'PROCESSING_PAYMENT': return t('wallet_details.status.processing', 'Procesando Pago')
      case 'WRONG_AMOUNT': return t('wallet_details.status.wrong_amount', 'Monto Incorrecto')
      default: return status
    }
  }, [t])

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }, [])

  const formatDateWithTime = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'medium',
    })
  }, [])

  return {
    address: wallet?.address || null,
    cUsdBalance: stablecoinBalances.cUsd,
    copiedAddress,
    formatDate,
    formatDateWithTime,
    getStatusStyle,
    getStatusText,
    hasMoreTransactions: pagination.hasMore,
    isLoadingBalance: stablecoinBalances.isLoading,
    isUnsupportedPreferredStablecoin: stablecoinBalances.topBalanceToken === 'cUSD',
    isLoadingMoreTransactions,
    isLoadingTransactions,
    onClose,
    onCopyAddress,
    onDisconnectWallet,
    onLoadMoreTransactions,
    onRefreshBalance,
    onRefreshTransactions,
    selectedTransaction,
    setSelectedTransaction,
    supportedTokenPreference: stablecoinBalances.supportedTokenPreference,
    topStablecoin: stablecoinBalances.topBalanceToken,
    transactionError,
    transactions,
    usdcBalance: stablecoinBalances.usdc,
    usdtBalance: stablecoinBalances.usdt,
  }
}
