import { Horizon } from '@stellar/stellar-sdk'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { fetchNonStellarBalances } from '../lib/chainBalanceFetchers'
import {
  formatStablecoinBalance,
  resolveStablecoinPreference,
  type StablecoinBalances,
  type StablecoinPreference,
  type SupportedStablecoinSymbol,
  UNAVAILABLE_STABLECOIN_PREFERENCE,
} from '../lib/stablecoinPortfolio'

const STELLAR_HORIZON_URL = 'https://horizon.stellar.org'
const STELLAR_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

type StablecoinBalanceState = {
  balances: null | StablecoinBalances
  cUsd: null | string
  error: null | string
  isLoading: boolean
  preference: StablecoinPreference
  refresh: () => Promise<void>
  supportedBalanceFor: (symbol: SupportedStablecoinSymbol) => null | string
  usdc: null | string
  usdt: null | string
}

const fetchStellarBalances = async (address: string): Promise<StablecoinBalances> => {
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
    cUSD: '0.00',
    USDC: formatStablecoinBalance(usdcBalance),
    USDT: '0.00',
  }
}

const fetchBalancesForChain = async (address: string, chainId: string): Promise<StablecoinBalances> => {
  if (chainId.startsWith('stellar:')) {
    return fetchStellarBalances(address)
  }
  if (chainId.startsWith('solana:')) {
    return fetchNonStellarBalances(address, chainId, 'solana')
  }
  if (chainId.startsWith('eip155:')) {
    return fetchNonStellarBalances(address, chainId, 'evm')
  }
  throw new Error('Balance queries are not supported for this network')
}

export const useStablecoinBalances = ({ address, chainId }: {
  address: null | string | undefined
  chainId: null | string | undefined
}): StablecoinBalanceState => {
  const [snapshot, setSnapshot] = useState<null | {
    balances: StablecoinBalances
    identity: string
  }>(null)
  const [error, setError] = useState<null | string>(null)
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)
  const identity = address && chainId ? `${chainId}:${address}` : null
  const balances = identity && snapshot?.identity === identity ? snapshot.balances : null

  const refresh = useCallback(async () => {
    if (!address || !chainId) {
      setSnapshot(null)
      setError(null)
      setIsLoading(false)
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
      setSnapshot({ balances: nextBalances, identity: `${chainId}:${address}` })
    }
    catch {
      if (requestIdRef.current !== requestId) {
        return
      }
      setError('Balance unavailable for the selected wallet and network')
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

  const preference = useMemo(() => (
    balances ? resolveStablecoinPreference(balances) : UNAVAILABLE_STABLECOIN_PREFERENCE
  ), [balances])
  const supportedBalanceFor = useCallback((symbol: SupportedStablecoinSymbol): null | string => (
    balances?.[symbol] ?? null
  ), [balances])

  return {
    balances,
    cUsd: balances?.cUSD ?? null,
    error,
    isLoading,
    preference,
    refresh,
    supportedBalanceFor,
    usdc: balances?.USDC ?? null,
    usdt: balances?.USDT ?? null,
  }
}
