import { Horizon } from '@stellar/stellar-sdk'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { fetchNonStellarBalances } from '../lib/chainBalanceFetchers'

const STELLAR_HORIZON_URL = 'https://horizon.stellar.org'
const STELLAR_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

export type HighestBalanceToken = 'cUSD' | 'USDC' | 'USDT'
export type SupportedStableToken = Exclude<HighestBalanceToken, 'cUSD'>

type StablecoinBalanceState = {
  cUsd: string
  error: null | string
  isLoading: boolean
  refresh: () => Promise<void>
  supportedBalanceFor: (symbol: SupportedStableToken) => string
  supportedTokenPreference: null | SupportedStableToken
  topBalanceToken: HighestBalanceToken
  usdc: string
  usdt: string
}

type BalanceSnapshot = {
  cUsd: string
  usdc: string
  usdt: string
}

const EMPTY_BALANCE_SNAPSHOT: BalanceSnapshot = {
  cUsd: '0.00',
  usdc: '0.00',
  usdt: '0.00',
}

const formatBalance = (value: number): string => (
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : '0.00'
)

const parseBalance = (value: string): number => {
  const normalized = value.replace(/,/g, '')
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

const resolveTopBalanceToken = (balances: BalanceSnapshot): HighestBalanceToken => {
  const rankedBalances: Array<{ amount: number, token: HighestBalanceToken }> = [
    { amount: parseBalance(balances.usdc), token: 'USDC' },
    { amount: parseBalance(balances.usdt), token: 'USDT' },
    { amount: parseBalance(balances.cUsd), token: 'cUSD' },
  ]

  rankedBalances.sort((left, right) => right.amount - left.amount)
  return rankedBalances[0]?.token ?? 'USDC'
}

const resolveSupportedPreference = (balances: BalanceSnapshot): null | SupportedStableToken => {
  const usdcBalance = parseBalance(balances.usdc)
  const usdtBalance = parseBalance(balances.usdt)
  if (usdcBalance <= 0 && usdtBalance <= 0) {
    return null
  }
  return usdcBalance >= usdtBalance ? 'USDC' : 'USDT'
}

const fetchStellarBalances = async (address: string): Promise<BalanceSnapshot> => {
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
    const usdcBalance = line && 'balance' in line ? parseFloat(line.balance) : 0
    return {
      cUsd: '0.00',
      usdc: formatBalance(usdcBalance),
      usdt: '0.00',
    }
  }
  catch {
    return EMPTY_BALANCE_SNAPSHOT
  }
}

const fetchBalancesForChain = async (address: string, chainId: string): Promise<BalanceSnapshot> => {
  if (chainId.startsWith('stellar:')) {
    return fetchStellarBalances(address)
  }
  if (chainId.startsWith('solana:')) {
    return fetchNonStellarBalances(address, chainId, 'solana')
  }
  if (chainId.startsWith('eip155:')) {
    return fetchNonStellarBalances(address, chainId, 'evm')
  }
  return EMPTY_BALANCE_SNAPSHOT
}

export const useStablecoinBalances = ({
  address,
  chainId,
}: {
  address: null | string | undefined
  chainId: null | string | undefined
}): StablecoinBalanceState => {
  const [balances, setBalances] = useState<BalanceSnapshot>(EMPTY_BALANCE_SNAPSHOT)
  const [error, setError] = useState<null | string>(null)
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!address || !chainId) {
      setBalances(EMPTY_BALANCE_SNAPSHOT)
      setError(null)
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setIsLoading(true)
    setError(null)

    try {
      const nextBalances = await fetchBalancesForChain(address, chainId)
      if (requestIdRef.current !== requestId) {
        return
      }
      setBalances(nextBalances)
    }
    catch (balanceError) {
      if (requestIdRef.current !== requestId) {
        return
      }
      setBalances(EMPTY_BALANCE_SNAPSHOT)
      setError(balanceError instanceof Error ? balanceError.message : 'Failed to load stablecoin balances')
    }
    finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false)
      }
    }
  }, [address, chainId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const topBalanceToken = useMemo(() => resolveTopBalanceToken(balances), [balances])
  const supportedTokenPreference = useMemo(() => resolveSupportedPreference(balances), [balances])
  const supportedBalanceFor = useCallback((symbol: SupportedStableToken): string => (
    symbol === 'USDT' ? balances.usdt : balances.usdc
  ), [balances.usdc, balances.usdt])

  return {
    cUsd: balances.cUsd,
    error,
    isLoading,
    refresh,
    supportedBalanceFor,
    supportedTokenPreference,
    topBalanceToken,
    usdc: balances.usdc,
    usdt: balances.usdt,
  }
}
