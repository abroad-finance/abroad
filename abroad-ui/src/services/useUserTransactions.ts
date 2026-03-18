import { useCallback, useState } from 'react'

import type { TransactionData, UserTransactionSummary } from './public/transactionTypes'

import { getUserTransactions } from './public/publicApi'

const NETWORK_TO_CHAIN: Record<string, string> = {
  CELO: 'Celo',
  ETHEREUM: 'Ethereum',
  SOLANA: 'Solana',
  STELLAR: 'Stellar',
}

export function useUserTransactions(isAuthenticated: boolean, selectedChainKey?: string) {
  const [transactions, setTransactions] = useState<TransactionData[]>([])
  const [allTransactions, setAllTransactions] = useState<TransactionData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingAll, setIsLoadingAll] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const fetchTransactions = useCallback(async (options?: { confirmedOnly?: boolean, page?: number, pageSize?: number }) => {
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
    }
    else {
      setError(result.error.message ?? 'Failed to fetch transactions')
    }

    setIsLoading(false)
  }, [isAuthenticated])

  const fetchAllTransactions = useCallback(async () => {
    if (!isAuthenticated) {
      setAllTransactions([])
      setIsLoadingAll(false)
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
    }
    else {
      setError(result.error.message ?? 'Failed to fetch all transactions')
    }

    setIsLoadingAll(false)
  }, [isAuthenticated])

  const filteredTransactions = selectedChainKey
    ? transactions.filter(tx => transactionMatchesChain(tx, selectedChainKey))
    : transactions
  const recentTransactions: UserTransactionSummary[] = filteredTransactions.slice(0, 2).map(mapTransactionToSummary)

  const allTransactionsDetail = allTransactions.map(mapTransactionToDetail)

  return {
    allTransactions: allTransactionsDetail,
    error,
    fetchAllTransactions,
    fetchTransactions,
    isLoading,
    isLoadingAll,
    recentTransactions,
    transactions,
  }
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

  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

function formatFullDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function mapTransactionToDetail(tx: TransactionData) {
  const country = tx.quote.targetCurrency === 'BRL' ? 'BR' : 'CO'
  const chain = NETWORK_TO_CHAIN[tx.quote.network] ?? 'Stellar'

  const statusMap: Record<string, 'completed' | 'expired' | 'pending'> = {
    AWAITING_PAYMENT: 'pending',
    PAYMENT_COMPLETED: 'completed',
    PAYMENT_EXPIRED: 'expired',
    PAYMENT_FAILED: 'expired',
    PROCESSING_PAYMENT: 'pending',
    WRONG_AMOUNT: 'expired',
  }

  return {
    accountNumber: tx.accountNumber,
    chain,
    country: country === 'BR' ? ('br' as const) : ('co' as const),
    date: formatFullDate(tx.createdAt),
    fee: '0.01',
    localAmount: tx.quote.targetAmount.toFixed(country === 'BR' ? 2 : 0),
    location: tx.externalId ?? undefined,
    merchant: tx.externalId ?? `••••${tx.accountNumber.slice(-4)}`,
    partnerId: undefined,
    settlementTime: tx.status === 'PAYMENT_COMPLETED' ? 'Instant' : '—',
    status: statusMap[tx.status] ?? 'pending',
    token: tx.quote.cryptoCurrency,
    transactionId: tx.onChainId ?? tx.id,
    usdcAmount: tx.quote.sourceAmount.toFixed(2),
  }
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

function networkFromChainKey(chainKey: string): string {
  const prefix = chainKey.split(':')[0]?.toLowerCase() ?? ''
  if (prefix === 'stellar') return 'STELLAR'
  if (prefix === 'solana') return 'SOLANA'
  if (prefix === 'celo' || prefix === 'eip155') return 'CELO'
  return 'STELLAR'
}

function transactionMatchesChain(tx: TransactionData, chainKey: string): boolean {
  return (tx.quote.network?.toUpperCase() ?? '') === networkFromChainKey(chainKey)
}
