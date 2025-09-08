import { Horizon } from '@stellar/stellar-sdk'
import { useTranslate } from '@tolgee/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { NavBarResponsiveProps } from '../../features/swap/components/NavBarResponsive'

import { useWebSocket } from '../../contexts/WebSocketContext'
import { useWalletAuth } from './useWalletAuth'

const DEFAULT_HORIZON_URL = 'https://horizon.stellar.org'
const DEFAULT_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const DEFAULT_INFO_URL = 'https://linktr.ee/Abroad.finance'

type BalanceLine
  = | { asset_code: string, asset_issuer: string, asset_type: string, balance: string }
    | { asset_type: 'native', balance: string }

interface FetchBalanceOpts { address: string, horizonUrl: string, usdcIssuer: string }

async function fetchUSDCBalance({ address, horizonUrl, usdcIssuer }: FetchBalanceOpts): Promise<string> {
  try {
    const server = new Horizon.Server(horizonUrl)
    const account = await server.loadAccount(address) as { balances: BalanceLine[] }
    const usdc = account.balances.find(
      (b): b is Extract<BalanceLine, { asset_code: string }> =>
        b.asset_type !== 'native'
        && 'asset_code' in b
        && b.asset_code === 'USDC'
        && 'asset_issuer' in b
        && b.asset_issuer === usdcIssuer,
    )
    if (!usdc) return '0.00'
    const n = parseFloat(usdc.balance || '0')
    if (!Number.isFinite(n)) return '0.00'
    return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.toLowerCase().includes('not found')) return '0.00'
    if (message.toLowerCase().includes('network')) return 'Error'
    return '0.00'
  }
}

function useUSDCBalance(address?: null | string, horizonUrl = DEFAULT_HORIZON_URL, usdcIssuer = DEFAULT_USDC_ISSUER) {
  const [balance, setBalance] = useState('0.00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const inFlight = useRef(0)

  const refetch = useCallback(async () => {
    if (!address) {
      setBalance('0.00')
      setError(null)
      return
    }
    const token = ++inFlight.current
    setLoading(true)
    setError(null)
    try {
      const b = await fetchUSDCBalance({ address, horizonUrl, usdcIssuer })
      if (token === inFlight.current) setBalance(b)
    }
    catch (e) {
      if (token === inFlight.current) {
        setError(e instanceof Error ? e.message : String(e))
        setBalance('0.00')
      }
    }
    finally {
      if (token === inFlight.current) setLoading(false)
    }
  }, [
    address,
    horizonUrl,
    usdcIssuer,
  ])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { balance, error, loading, refetch }
}

const normalizeWalletKind = (id?: null | string) => {
  if (!id) return 'unknown'
  const v = id.toLowerCase()
  if (v.includes('freighter')) return 'freighter'
  if (v.includes('hana')) return 'hana'
  if (v.includes('lobstr')) return 'lobstr'
  if (v.includes('xbull')) return 'xbull'
  if (v.includes('rabet')) return 'rabet'
  if (v.includes('stellar') || v.includes('trust')) return 'stellar'
  return 'unknown'
}

interface UseNavBarResponsiveArgs {
  horizonUrl?: string
  infoUrl?: string
  onWalletConnect?: () => void
  onWalletDetails?: () => void
  usdcIssuer?: string
}

type UseNavBarResponsiveResult = Pick<NavBarResponsiveProps,
  'address' | 'balance' | 'balanceLoading' | 'infoUrl' | 'labels' | 'onWalletClick' | 'walletInfo'
>

export function useNavBarResponsive({
  horizonUrl = DEFAULT_HORIZON_URL,
  infoUrl = DEFAULT_INFO_URL,
  onWalletConnect,
  onWalletDetails,
  usdcIssuer = DEFAULT_USDC_ISSUER,
}: UseNavBarResponsiveArgs = {}): UseNavBarResponsiveResult {
  const { kit } = useWalletAuth()
  const { off, on } = useWebSocket()
  const { t } = useTranslate()
  const { balance, loading: balanceLoading, refetch } = useUSDCBalance(kit?.address, horizonUrl, usdcIssuer)

  // Refresh balance when a transaction event arrives for this user
  useEffect(() => {
    const refresh = () => {
      void refetch()
    }
    on('transaction.created', refresh)
    on('transaction.updated', refresh)
    return () => {
      off('transaction.created', refresh)
      off('transaction.updated', refresh)
    }
  }, [
    on,
    off,
    refetch,
  ])

  const handleDirectWalletConnect = useCallback(async () => {
    if (onWalletConnect) return onWalletConnect()
    try {
      await kit?.connect()
    }
    catch { /* noop */ }
  }, [onWalletConnect, kit])

  const onWalletClick = useCallback(() => {
    if (kit?.address) onWalletDetails?.()
    else handleDirectWalletConnect()
  }, [
    kit?.address,
    onWalletDetails,
    handleDirectWalletConnect,
  ])

  const walletInfo = useMemo(() => {
    const kind = normalizeWalletKind(kit?.walletId)
    const map: Record<string, { icon?: string, name: string }> = {
      freighter: { name: 'Freighter' },
      hana: { name: 'Hana' },
      lobstr: { name: 'Lobstr' },
      rabet: { name: 'Rabet' },
      stellar: { name: 'Stellar Wallet' },
      unknown: { name: 'Stellar Wallet' },
      xbull: { name: 'xBull' },
    }
    return map[kind] || map.unknown
  }, [kit?.walletId])

  const labels = useMemo(() => ({
    connectWallet: t('navbar.connect_wallet', 'Conectar Billetera'),
    connectWalletAria: t('navbar.connect_wallet_aria', 'Conectar billetera'),
    infoAriaLabel: t('navbar.info_aria_label', 'Información de Abroad'),
    notConnected: t('navbar.not_connected', 'No conectado'),
    walletDetailsAria: t('navbar.wallet_details_aria', 'Ver detalles de la billetera'),
  }), [t])

  return {
    address: kit?.address || null,
    balance,
    balanceLoading,
    infoUrl,
    labels,
    onWalletClick,
    walletInfo,
  }
}
