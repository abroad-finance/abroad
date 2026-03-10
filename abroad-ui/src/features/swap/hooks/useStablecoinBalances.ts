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
  balanceForStablecoin,
  EMPTY_STABLECOIN_BALANCES,
  formatStablecoinBalance,
  resolveStablecoinPreference,
  type StablecoinBalances,
  type StablecoinPreference,
  type SupportedStablecoinSymbol,
} from '../lib/stablecoinPortfolio'

const STELLAR_HORIZON_URL = 'https://horizon.stellar.org'
const STELLAR_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

type StablecoinBalanceState = {
  balances: StablecoinBalances
  cUsd: string
  error: null | string
  isLoading: boolean
  preference: StablecoinPreference
  refresh: () => Promise<void>
  supportedBalanceFor: (symbol: SupportedStablecoinSymbol) => string
  usdc: string
  usdt: string
}

const fetchStellarBalances = async (address: string): Promise<StablecoinBalances> => {
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
      cUSD: '0.00',
      USDC: formatStablecoinBalance(usdcBalance),
      USDT: '0.00',
    }
  }
  catch {
    return EMPTY_STABLECOIN_BALANCES
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
  return EMPTY_STABLECOIN_BALANCES
}

export const useStablecoinBalances = ({
  address,
  chainId,
}: {
  address: null | string | undefined
  chainId: null | string | undefined
}): StablecoinBalanceState => {
  const [balances, setBalances] = useState<StablecoinBalances>(EMPTY_STABLECOIN_BALANCES)
  const [error, setError] = useState<null | string>(null)
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!address || !chainId) {
      setBalances(EMPTY_STABLECOIN_BALANCES)
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
      setBalances(EMPTY_STABLECOIN_BALANCES)
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

  const preference = useMemo(() => resolveStablecoinPreference(balances), [balances])
  const supportedBalanceFor = useCallback((symbol: SupportedStablecoinSymbol): string => (
    balanceForStablecoin(balances, symbol)
  ), [balances])

  return {
    balances,
    cUsd: balances.cUSD,
    error,
    isLoading,
    preference,
    refresh,
    supportedBalanceFor,
    usdc: balances.USDC,
    usdt: balances.USDT,
  }
}
