import { Horizon } from '@stellar/stellar-sdk'
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

// Stellar network configuration
const STELLAR_HORIZON_URL = 'https://horizon.stellar.org'
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
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
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00')
  const [isLoadingBalance, setIsLoadingBalance] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const transactionsRef = useRef<Transaction[]>([])
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false)
  const [isLoadingMoreTransactions, setIsLoadingMoreTransactions] = useState(false)
  const [transactionError, setTransactionError] = useState<null | string>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<null | TransactionListItem>(null)
  const pageSizeRef = useRef<number>(DEFAULT_TRANSACTIONS_PAGE_SIZE)
  const transactionsAbortRef = useRef<AbortController | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({
    currentPage: 0,
    hasMore: false,
    total: 0,
  })
  useEffect(() => {
    transactionsRef.current = transactions
  }, [transactions])

  useEffect(() => {
    return () => {
      transactionsAbortRef.current?.abort()
    }
  }, [])

  // Fetch USDC balance (isolated for clarity)
  const fetchUSDCBalance = useCallback(async (stellarAddress: string): Promise<string> => {
    try {
      const server = new Horizon.Server(STELLAR_HORIZON_URL)
      const account = await server.loadAccount(stellarAddress)
      const usdcBalance = account.balances.find(balance => (
        balance.asset_type !== 'native'
        && 'asset_code' in balance
        && 'asset_issuer' in balance
        && balance.asset_code === 'USDC'
        && balance.asset_issuer === USDC_ISSUER
      ))
      if (usdcBalance && 'balance' in usdcBalance) {
        const balanceValue = parseFloat(usdcBalance.balance)
        return balanceValue.toLocaleString('en-US', {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })
      }
      return '0.00'
    }
    catch {
      return '0.00'
    }
  }, [])

  const fetchUSDCBalanceWithLoading = useCallback(async (stellarAddress: string) => {
    try {
      setIsLoadingBalance(true)
      const balance = await fetchUSDCBalance(stellarAddress)
      setUsdcBalance(balance)
    }
    catch {
      setUsdcBalance('0.00')
    }
    finally { setIsLoadingBalance(false) }
  }, [fetchUSDCBalance])

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
    const isStellar = wallet?.chainId?.startsWith('stellar:') ?? false
    if (isStellar && wallet?.address) fetchUSDCBalanceWithLoading(wallet.address)
    if (wallet?.address && wallet?.chainId && walletAuthentication?.jwtToken) {
      loadTransactions({ append: false, page: 1 })
    }
  }, [
    wallet?.address,
    wallet?.chainId,
    walletAuthentication?.jwtToken,
    fetchUSDCBalanceWithLoading,
    loadTransactions,
  ])

  // Subscribe to websocket notifications to refresh transactions and balance
  const refreshFromEvent = useCallback(() => {
    if (!wallet?.address || !wallet?.chainId || !walletAuthentication?.jwtToken) return
    void loadTransactions({ append: false, page: 1 })
    const isStellar = wallet.chainId.startsWith('stellar:')
    if (isStellar) fetchUSDCBalanceWithLoading(wallet.address)
  }, [
    fetchUSDCBalanceWithLoading,
    wallet?.address,
    wallet?.chainId,
    loadTransactions,
    walletAuthentication?.jwtToken,
  ])

  useWebSocketSubscription('transaction.created', refreshFromEvent)
  useWebSocketSubscription('transaction.updated', refreshFromEvent)
  useWebSocketSubscription('connect_error', (err) => {
    setTransactionError(err.message || 'WS connection error')
  })

  // Handlers exposed to component
  const onRefreshBalance = useCallback(() => {
    if (!wallet?.address || !wallet?.chainId) return
    if (!wallet.chainId.startsWith('stellar:')) return
    if (!isLoadingBalance) fetchUSDCBalanceWithLoading(wallet.address)
  }, [
    wallet?.address,
    wallet?.chainId,
    isLoadingBalance,
    fetchUSDCBalanceWithLoading,
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

  return {
    address: wallet?.address || null,
    copiedAddress,
    formatDate,
    getStatusStyle,
    getStatusText,
    hasMoreTransactions: pagination.hasMore,
    isLoadingBalance,
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
    transactionError,
    transactions,
    usdcBalance,
  }
}
