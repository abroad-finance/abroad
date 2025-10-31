import { Horizon } from '@stellar/stellar-sdk'
import { useTranslate } from '@tolgee/react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { listPartnerTransactions, PaginatedTransactionListTransactionsItem } from '../../../api'
import { useWebSocket } from '../../../contexts/WebSocketContext'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'
import { WalletDetailsProps } from '../components/WalletDetails'

// Stellar network configuration
const STELLAR_HORIZON_URL = 'https://horizon.stellar.org'
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const DEFAULT_TRANSACTIONS_PAGE_SIZE = 10

interface PaginationState {
  currentPage: number
  hasMore: boolean
  total: number
}

interface Params { onClose?: () => void }

// Transaction type
type Transaction = PaginatedTransactionListTransactionsItem

// Hook encapsulating all stateful logic from WalletDetails component.
export function useWalletDetails(params: Params = {}): WalletDetailsProps {
  const { onClose } = params
  const { t } = useTranslate()
  const { kit, walletAuthentication } = useWalletAuth()

  const [copiedAddress, setCopiedAddress] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00')
  const [isLoadingBalance, setIsLoadingBalance] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false)
  const [isLoadingMoreTransactions, setIsLoadingMoreTransactions] = useState(false)
  const [transactionError, setTransactionError] = useState<null | string>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<null | PaginatedTransactionListTransactionsItem>(null)
  const { off, on } = useWebSocket()
  const pageSizeRef = useRef<number>(DEFAULT_TRANSACTIONS_PAGE_SIZE)
  const [pagination, setPagination] = useState<PaginationState>({
    currentPage: 0,
    hasMore: false,
    total: 0,
  })

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

  const loadTransactions = useCallback(async ({ page, append }: { page: number; append: boolean }) => {
    if (!walletAuthentication?.jwtToken) {
      setTransactionError(t('wallet_details.error.no_token', 'No authentication token available'))
      return
    }

    if (!kit?.address) {
      setTransactionError(t('wallet_details.error.no_address', 'No wallet address connected'))
      return
    }

    const setLoadingState = append ? setIsLoadingMoreTransactions : setIsLoadingTransactions

    try {
      setLoadingState(true)
      setTransactionError(null)

      const response = await listPartnerTransactions({
        externalUserId: kit.address,
        page,
        pageSize: pageSizeRef.current,
      })

      if (response.status !== 200) {
        const fallback = t('wallet_details.error.fetch_failed', 'Failed to fetch transactions')
        setTransactionError('reason' in response.data ? response.data.reason || fallback : fallback)
        return
      }

      const {
        pageSize,
        total,
        transactions: pageTransactions,
      } = response.data

      if (pageSize && pageSize > 0) pageSizeRef.current = pageSize

      const nextTransactions = Array.isArray(pageTransactions) ? pageTransactions : []
      let aggregatedTransactions: Transaction[] = []

      setTransactions(prevTransactions => {
        aggregatedTransactions = append ? [...prevTransactions, ...nextTransactions] : nextTransactions
        return aggregatedTransactions
      })

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
    catch {
      setTransactionError(t('wallet_details.error.loading', 'Error loading transactions'))
    }
    finally {
      setLoadingState(false)
    }
  }, [
    walletAuthentication?.jwtToken,
    t,
    kit?.address,
  ])

  // Effects
  useEffect(() => {
    if (kit?.address) fetchUSDCBalanceWithLoading(kit.address)
    if (kit?.address && walletAuthentication?.jwtToken) {
      loadTransactions({ page: 1, append: false })
    }
  }, [
    kit?.address,
    walletAuthentication?.jwtToken,
    fetchUSDCBalanceWithLoading,
    loadTransactions,
  ])

  // Subscribe to websocket notifications to refresh transactions and balance
  useEffect(() => {
    if (!kit?.address || !walletAuthentication?.jwtToken) return

    const refresh = async () => {
      if (!kit?.address) return
      try {
        // Optimistically refresh in background, keep UI responsive
        await loadTransactions({ page: 1, append: false })
        fetchUSDCBalanceWithLoading(kit.address)
      }
      catch { /* no-op */ }
    }

    on('transaction.created', refresh)
    on('transaction.updated', refresh)
    const onConnectError = (err: Error) => setTransactionError(err.message || 'WS connection error')
    on('connect_error', onConnectError)

    return () => {
      off('connect_error', onConnectError)
      off('transaction.created', refresh)
      off('transaction.updated', refresh)
    }
  }, [
    kit?.address,
    loadTransactions,
    fetchUSDCBalanceWithLoading,
    on,
    off,
    walletAuthentication?.jwtToken,
  ])

  // Handlers exposed to component
  const onRefreshBalance = useCallback(() => {
    if (kit?.address && !isLoadingBalance) fetchUSDCBalanceWithLoading(kit.address)
  }, [
    kit?.address,
    isLoadingBalance,
    fetchUSDCBalanceWithLoading,
  ])

  const onRefreshTransactions = useCallback(() => {
    if (!walletAuthentication?.jwtToken || !kit?.address) return
    if (isLoadingTransactions || isLoadingMoreTransactions) return
    loadTransactions({ page: 1, append: false })
  }, [
    walletAuthentication?.jwtToken,
    kit?.address,
    isLoadingTransactions,
    isLoadingMoreTransactions,
    loadTransactions,
  ])

  const onLoadMoreTransactions = useCallback(() => {
    if (!walletAuthentication?.jwtToken || !kit?.address) return
    if (!pagination.hasMore || isLoadingTransactions || isLoadingMoreTransactions) return
    loadTransactions({ page: pagination.currentPage + 1, append: true })
  }, [
    walletAuthentication?.jwtToken,
    kit?.address,
    pagination.hasMore,
    pagination.currentPage,
    isLoadingTransactions,
    isLoadingMoreTransactions,
    loadTransactions,
  ])

  const onCopyAddress = useCallback(async () => {
    try {
      if (kit?.address) {
        await navigator.clipboard.writeText(kit.address)
        setCopiedAddress(true)
        setTimeout(() => setCopiedAddress(false), 2000)
      }
    }
    catch { /* swallow */ }
  }, [kit?.address])

  const onDisconnectWallet = useCallback(async () => {
    try {
      await kit?.disconnect()
      onClose?.()
    }
    catch { /* swallow */ }
  }, [kit, onClose])

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
    address: kit?.address || null,
    copiedAddress,
    formatDate,
    getStatusStyle,
    getStatusText,
    isLoadingBalance,
    isLoadingTransactions,
    isLoadingMoreTransactions,
    hasMoreTransactions: pagination.hasMore,
    onClose,
    onCopyAddress,
    onDisconnectWallet,
    onRefreshBalance,
    onLoadMoreTransactions,
    onRefreshTransactions,
    selectedTransaction,
    setSelectedTransaction,
    transactionError,
    transactions,
    usdcBalance,
  }
}
