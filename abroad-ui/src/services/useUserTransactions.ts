import { useCallback, useState } from 'react'

import type { TransactionData, UserTransactionSummary } from '../services/public/transactionTypes'
import { getUserTransactions } from '../services/public/publicApi'


const NETWORK_TO_CHAIN: Record<string, string> = {
  STELLAR: 'Stellar',
  SOLANA: 'Solana',
  CELO: 'Celo',
  ETHEREUM: 'Ethereum',
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatFullDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function mapTransactionToSummary(tx: TransactionData): UserTransactionSummary {
  const country = tx.quote.targetCurrency === 'BRL' ? 'BR' : 'CO'

  return {
    country: tx.quote.targetCurrency,
    localAmount: tx.quote.targetAmount.toFixed(country === 'BR' ? 2 : 0),
    merchant: tx.accountNumber.slice(-4) ? `••••${tx.accountNumber.slice(-4)}` : 'Unknown',
    time: formatDate(tx.createdAt),
    usdcAmount: tx.quote.sourceAmount.toFixed(2),
  }
}

function mapTransactionToDetail(tx: TransactionData) {
  const country = tx.quote.targetCurrency === 'BRL' ? 'BR' : 'CO'
  const chain = NETWORK_TO_CHAIN[tx.quote.network] ?? 'Stellar'

  const statusMap: Record<string, 'completed' | 'expired' | 'pending'> = {
    PAYMENT_COMPLETED: 'completed',
    PAYMENT_EXPIRED: 'expired',
    AWAITING_PAYMENT: 'pending',
    PROCESSING_PAYMENT: 'pending',
    PAYMENT_FAILED: 'expired',
    WRONG_AMOUNT: 'expired',
  }

  return {
    accountNumber: tx.accountNumber,
    chain,
    country: (country === 'BR' ? 'br' : 'co') as 'br' | 'co',
    date: formatFullDate(tx.createdAt),
    fee: '0.01',
    localAmount: tx.quote.targetAmount.toFixed(country === 'BR' ? 2 : 0),
    merchant: tx.externalId ?? `••••${tx.accountNumber.slice(-4)}`,
    location: tx.externalId ?? undefined,
    partnerId: undefined,
    settlementTime: tx.status === 'PAYMENT_COMPLETED' ? 'Instant' : '—',
    status: statusMap[tx.status] ?? 'pending',
    token: tx.quote.cryptoCurrency,
    transactionId: tx.onChainId ?? tx.id,
    usdcAmount: tx.quote.sourceAmount.toFixed(2),
  }
}

export function useUserTransactions(isAuthenticated: boolean) {
  const [transactions, setTransactions] = useState<TransactionData[]>([])
  const [allTransactions, setAllTransactions] = useState<TransactionData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingAll, setIsLoadingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTransactions = useCallback(async (options?: { confirmedOnly?: boolean; page?: number; pageSize?: number }) => {
    if (!isAuthenticated) {
      setTransactions([])
      return
    }

    setIsLoading(true)
    setError(null)

    const result = await getUserTransactions({
      confirmedOnly: options?.confirmedOnly ?? false,
      page: options?.page ?? 1,
      pageSize: options?.pageSize ?? 20,
    })

    if (result.ok) {
      setTransactions(result.data.transactions)
    } else {
      setError(result.error.message ?? 'Failed to fetch transactions')
    }

    setIsLoading(false)
  }, [isAuthenticated])

  const fetchAllTransactions = useCallback(async () => {
    if (!isAuthenticated) {
      setAllTransactions([])
      return
    }

    setIsLoadingAll(true)
    setError(null)

    // Fetch all transactions (not just confirmed) with larger page size
    const result = await getUserTransactions({
      confirmedOnly: false,
      page: 1,
      pageSize: 100,
    })

    if (result.ok) {
      setAllTransactions(result.data.transactions)
    } else {
      setError(result.error.message ?? 'Failed to fetch all transactions')
    }

    setIsLoadingAll(false)
  }, [isAuthenticated])

  const recentTransactions: UserTransactionSummary[] = transactions.slice(0, 2).map(mapTransactionToSummary)

  const allTransactionsDetail = allTransactions.map(mapTransactionToDetail)

  return {
    transactions,
    recentTransactions,
    allTransactions: allTransactionsDetail,
    isLoading,
    isLoadingAll,
    error,
    fetchTransactions,
    fetchAllTransactions,
  }
}
