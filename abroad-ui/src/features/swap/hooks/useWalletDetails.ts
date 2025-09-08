import { Horizon } from '@stellar/stellar-sdk'
import { useTranslate } from '@tolgee/react'
import { useCallback, useEffect, useState } from 'react'

import { listPartnerTransactions, PaginatedTransactionListTransactionsItem } from '../../../api'
import { useWebSocket } from '../../../contexts/WebSocketContext'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'
import { WalletDetailsProps } from '../components/WalletDetails'

// Stellar network configuration
const STELLAR_HORIZON_URL = 'https://horizon.stellar.org'
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

interface Params { onClose?: () => void }

// Transaction type
type Transaction = PaginatedTransactionListTransactionsItem

// Hook encapsulating all stateful logic from WalletDetails component.
export function useWalletDetails(params: Params = {}): WalletDetailsProps {
  const { onClose } = params
  const { t } = useTranslate()
  const { kit, token } = useWalletAuth()

  const [copiedAddress, setCopiedAddress] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00')
  const [isLoadingBalance, setIsLoadingBalance] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false)
  const [transactionError, setTransactionError] = useState<null | string>(null)
  const { off, on } = useWebSocket()

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
        return balanceValue.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
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

  const fetchTransactions = useCallback(async () => {
    if (!token) {
      setTransactionError(t('wallet_details.error.no_token', 'No authentication token available'))
      return
    }
    try {
      setIsLoadingTransactions(true)
      setTransactionError(null)
      if (!kit?.address) {
        setTransactionError(t('wallet_details.error.no_address', 'No wallet address connected'))
        return
      }
      const response = await listPartnerTransactions(
        { externalUserId: kit.address, page: 1, pageSize: 10 },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (response.status === 200) setTransactions(response.data.transactions)
      else setTransactionError(t('wallet_details.error.fetch_failed', 'Failed to fetch transactions'))
    }
    catch {
      setTransactionError(t('wallet_details.error.loading', 'Error loading transactions'))
    }
    finally { setIsLoadingTransactions(false) }
  }, [
    token,
    t,
    kit?.address,
  ])

  // Effects
  useEffect(() => {
    if (kit?.address) fetchUSDCBalanceWithLoading(kit.address)
    if (token) fetchTransactions()
  }, [
    kit?.address,
    token,
    fetchUSDCBalanceWithLoading,
    fetchTransactions,
  ])

  // Subscribe to websocket notifications to refresh transactions and balance
  useEffect(() => {
    if (!kit?.address || !token) return

    const refresh = async () => {
      if (!kit?.address) return
      try {
        // Optimistically refresh in background, keep UI responsive
        fetchTransactions()
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
    token,
    fetchTransactions,
    fetchUSDCBalanceWithLoading,
    on,
    off,
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
    if (token && !isLoadingTransactions) fetchTransactions()
  }, [
    token,
    isLoadingTransactions,
    fetchTransactions,
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
      case 'PAYMENT_FAILED':
      case 'WRONG_AMOUNT': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }, [])

  const getStatusText = useCallback((status: string) => {
    switch (status) {
      case 'AWAITING_PAYMENT': return t('wallet_details.status.awaiting_payment', 'Esperando Pago')
      case 'PAYMENT_COMPLETED': return t('wallet_details.status.completed', 'Completado')
      case 'PAYMENT_FAILED': return t('wallet_details.status.failed', 'Pago Fallido')
      case 'PROCESSING_PAYMENT': return t('wallet_details.status.processing', 'Procesando Pago')
      case 'WRONG_AMOUNT': return t('wallet_details.status.wrong_amount', 'Monto Incorrecto')
      default: return status
    }
  }, [t])

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
  }, [])

  return {
    address: kit?.address || null,
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
  }
}
