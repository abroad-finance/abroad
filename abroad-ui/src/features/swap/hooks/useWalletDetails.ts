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
import { fetchNonStellarBalances } from '../lib/chainBalanceFetchers'

// Stellar: only USDC. Other chains (Solana, EVM/Celo) use USDC + USDT.
const STELLAR_HORIZON_URL = 'https://horizon.stellar.org'
const STELLAR_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
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
  const [usdtBalance, setUsdtBalance] = useState<string>('0.00')
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

  const formatBalance = useCallback((n: number): string => (
    Number.isFinite(n)
      ? n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
      : '0.00'
  ), [])

  const fetchStellarUSDCOnly = useCallback(async (address: string): Promise<{ usdc: string, usdt: string }> => {
    try {
      const server = new Horizon.Server(STELLAR_HORIZON_URL)
      const account = await server.loadAccount(address)
      const line = account.balances.find(balance => (
        balance.asset_type !== 'native'
        && 'asset_code' in balance
        && 'asset_issuer' in balance
        && balance.asset_code === 'USDC'
        && balance.asset_issuer === STELLAR_USDC_ISSUER
      ))
      const n = line && 'balance' in line ? parseFloat(line.balance) : 0
      return { usdc: formatBalance(n), usdt: '0.00' }
    }
    catch {
      return { usdc: '0.00', usdt: '0.00' }
    }
  }, [formatBalance])

  const fetchBalancesForChain = useCallback(async (address: string, chainId: null | string): Promise<{ usdc: string, usdt: string }> => {
    if (!chainId || !address) return { usdc: '0.00', usdt: '0.00' }
    if (chainId.startsWith('stellar:')) return fetchStellarUSDCOnly(address)
    if (chainId.startsWith('solana:')) return fetchNonStellarBalances(address, chainId, 'solana')
    if (chainId.startsWith('eip155:')) return fetchNonStellarBalances(address, chainId, 'evm')
    return { usdc: '0.00', usdt: '0.00' }
  }, [fetchStellarUSDCOnly])

  const fetchBalancesWithLoading = useCallback(async (address: string, chainId: null | string) => {
    try {
      setIsLoadingBalance(true)
      const { usdc, usdt } = await fetchBalancesForChain(address, chainId)
      setUsdcBalance(usdc)
      setUsdtBalance(usdt)
    }
    catch {
      setUsdcBalance('0.00')
      setUsdtBalance('0.00')
    }
    finally { setIsLoadingBalance(false) }
  }, [fetchBalancesForChain])

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
    if (wallet?.address && wallet?.chainId) {
      fetchBalancesWithLoading(wallet.address, wallet.chainId)
    }
    if (wallet?.address && wallet?.chainId && walletAuthentication?.jwtToken) {
      loadTransactions({ append: false, page: 1 })
    }
  }, [
    wallet?.address,
    wallet?.chainId,
    walletAuthentication?.jwtToken,
    fetchBalancesWithLoading,
    loadTransactions,
  ])

  // Subscribe to websocket notifications to refresh transactions and balance
  const refreshFromEvent = useCallback(() => {
    if (!wallet?.address || !wallet?.chainId || !walletAuthentication?.jwtToken) return
    void loadTransactions({ append: false, page: 1 })
    fetchBalancesWithLoading(wallet.address, wallet.chainId)
  }, [
    fetchBalancesWithLoading,
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
    if (!wallet?.address || !wallet?.chainId || isLoadingBalance) return
    fetchBalancesWithLoading(wallet.address, wallet.chainId)
  }, [
    wallet?.address,
    wallet?.chainId,
    isLoadingBalance,
    fetchBalancesWithLoading,
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
    copiedAddress,
    formatDate,
    formatDateWithTime,
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
    usdtBalance,
  }
}
