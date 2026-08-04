import { useTranslate } from '@tolgee/react'
import { useMemo } from 'react'

import type { NavBarResponsiveProps } from '../../features/swap/components/NavBarResponsive'

import { ABROAD_SUPPORT_URL } from '../constants'
import { useTheme } from './useTheme'
import { useWalletAuth } from './useWalletAuth'

const DEFAULT_INFO_URL = ABROAD_SUPPORT_URL

const normalizeWalletKind = (id?: null | string) => {
  if (!id) return 'unknown'
  const v = id.toLowerCase()
  if (v.includes('wallet-connect')) return 'walletconnect'
  if (v.includes('freighter')) return 'freighter'
  if (v.includes('hana')) return 'hana'
  if (v.includes('lobstr')) return 'lobstr'
  if (v.includes('xbull')) return 'xbull'
  if (v.includes('rabet')) return 'rabet'
  if (v.includes('stellar') || v.includes('trust')) return 'stellar'
  return 'unknown'
}

type UseNavBarResponsiveResult = Pick<NavBarResponsiveProps,
  'address' | 'hideWalletButton' | 'infoUrl' | 'isDark' | 'labels' | 'onToggleTheme' | 'walletInfo'
>

export function useNavBarResponsive(infoUrl = DEFAULT_INFO_URL): UseNavBarResponsiveResult {
  const { miniPay, wallet } = useWalletAuth()
  const { t } = useTranslate()
  const { isDark, toggleTheme } = useTheme()
  const walletInfo = useMemo(() => {
    const kind = normalizeWalletKind(wallet?.walletId)
    const map: Record<string, { icon?: string
      name: string }> = {
      freighter: { name: 'Freighter' },
      hana: { name: 'Hana' },
      lobstr: { name: 'Lobstr' },
      rabet: { name: 'Rabet' },
      stellar: { name: 'Stellar Wallet' },
      unknown: { name: 'Wallet' },
      walletconnect: { name: 'WalletConnect' },
      xbull: { name: 'xBull' },
    }
    return map[kind] || map.unknown
  }, [wallet?.walletId])

  const labels = useMemo(() => ({
    connected: t('navbar.connected', 'Connected'),
    connectWallet: t('navbar.connect_wallet', 'Connect Wallet'),
    connectWalletAria: t('navbar.connect_wallet_aria', 'Connect wallet'),
    disconnectAria: t('navbar.disconnect_aria', 'Disconnect wallet'),
    disconnectFailed: t('navbar.disconnect_failed', 'Could not disconnect the wallet. Please try again.'),
    disconnectTitle: t('navbar.disconnect_title', 'Disconnect wallet'),
    history: t('navbar.activity', 'Activity'),
    infoAriaLabel: t('navbar.info_aria_label', 'Abroad information'),
    language: t('navbar.language', 'Language'),
    notConnected: t('navbar.not_connected', 'Not connected'),
    useDarkTheme: t('navbar.use_dark_theme', 'Use dark theme'),
    useLightTheme: t('navbar.use_light_theme', 'Use light theme'),
    utilities: t('navbar.utilities', 'Language, help, and account options'),
  }), [t])

  return {
    address: wallet?.address || null,
    hideWalletButton: miniPay.isActive,
    infoUrl,
    isDark,
    labels,
    onToggleTheme: toggleTheme,
    walletInfo,
  }
}
