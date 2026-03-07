import type { PublicCorridor } from '../../services/public/types'
import type { StablecoinPreference } from '../../features/swap/lib/stablecoinPortfolio'

import { MINIPAY_ADD_CASH_URL } from '../../services/wallets/minipay'

export type MiniPayNotice = {
  ctaHref: string
  ctaLabel: string
  description: string
  title: string
}

export type MiniPayNoticeCopy = {
  addCashLabel: string
  cUsdDescription: string
  cUsdTitle: string
  lowBalanceDescription: string
  lowBalanceTitle: string
}

export type WalletUserId = `${string}:${string}`

export const scopeCorridorsForWalletSurface = ({
  corridors,
  isMiniPay,
}: {
  corridors: PublicCorridor[]
  isMiniPay: boolean
}): PublicCorridor[] => (
  isMiniPay
    ? corridors.filter(corridor => corridor.blockchain === 'CELO')
    : corridors
)

export const resolvePreferredMiniPayCorridor = ({
  availableCorridors,
  preference,
}: {
  availableCorridors: PublicCorridor[]
  preference: StablecoinPreference
}): null | PublicCorridor => {
  const preferredToken = preference.preferredSupportedToken
  if (!preferredToken) {
    return null
  }

  return availableCorridors.find(corridor => corridor.cryptoCurrency === preferredToken) ?? null
}

export const resolveMiniPayNotice = ({
  copy,
  hasInsufficientFunds,
  isMiniPay,
  preference,
}: {
  copy: MiniPayNoticeCopy
  hasInsufficientFunds: boolean
  isMiniPay: boolean
  preference: StablecoinPreference
}): MiniPayNotice | null => {
  if (!isMiniPay) {
    return null
  }

  if (preference.kind === 'unsupported-preferred') {
    return {
      ctaHref: MINIPAY_ADD_CASH_URL,
      ctaLabel: copy.addCashLabel,
      description: copy.cUsdDescription,
      title: copy.cUsdTitle,
    }
  }

  if (hasInsufficientFunds) {
    return {
      ctaHref: MINIPAY_ADD_CASH_URL,
      ctaLabel: copy.addCashLabel,
      description: copy.lowBalanceDescription,
      title: copy.lowBalanceTitle,
    }
  }

  return null
}

export const buildWalletUserId = (
  chainId: null | string,
  address: null | string,
): null | WalletUserId => {
  if (!chainId || !address) {
    return null
  }

  return `${chainId}:${address}`
}
