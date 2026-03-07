export type StablecoinSymbol = 'cUSD' | 'USDC' | 'USDT'
export type SupportedStablecoinSymbol = Exclude<StablecoinSymbol, 'cUSD'>

export type StablecoinBalances = Readonly<Record<StablecoinSymbol, string>>

export type StablecoinPreference =
  | {
      highestBalanceToken: StablecoinSymbol
      kind: 'empty'
      preferredSupportedToken: null
    }
  | {
      highestBalanceToken: SupportedStablecoinSymbol
      kind: 'supported'
      preferredSupportedToken: SupportedStablecoinSymbol
    }
  | {
      highestBalanceToken: 'cUSD'
      kind: 'unsupported-preferred'
      preferredSupportedToken: null | SupportedStablecoinSymbol
    }

export const EMPTY_STABLECOIN_BALANCES: StablecoinBalances = Object.freeze({
  cUSD: '0.00',
  USDC: '0.00',
  USDT: '0.00',
})

export const formatStablecoinBalance = (value: number): string => (
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : '0.00'
)

export const parseStablecoinBalance = (value: string): number => {
  const normalized = value.replace(/,/g, '')
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export const isSupportedStablecoinSymbol = (value: string): value is SupportedStablecoinSymbol => (
  value === 'USDC' || value === 'USDT'
)

export const balanceForStablecoin = (
  balances: StablecoinBalances,
  symbol: StablecoinSymbol,
): string => balances[symbol]

const rankStablecoinBalances = (
  balances: StablecoinBalances,
): Array<{ amount: number, token: StablecoinSymbol }> => {
  const rankedBalances: Array<{ amount: number, token: StablecoinSymbol }> = [
    { amount: parseStablecoinBalance(balances.USDC), token: 'USDC' },
    { amount: parseStablecoinBalance(balances.USDT), token: 'USDT' },
    { amount: parseStablecoinBalance(balances.cUSD), token: 'cUSD' },
  ]

  rankedBalances.sort((left, right) => right.amount - left.amount)
  return rankedBalances
}

export const resolveStablecoinPreference = (
  balances: StablecoinBalances,
): StablecoinPreference => {
  const rankedBalances = rankStablecoinBalances(balances)
  const highestBalanceToken = rankedBalances[0]?.token ?? 'USDC'
  const preferredSupportedToken = rankedBalances.find(
    candidate => candidate.amount > 0 && isSupportedStablecoinSymbol(candidate.token),
  )?.token ?? null

  if (!preferredSupportedToken) {
    return {
      highestBalanceToken,
      kind: 'empty',
      preferredSupportedToken: null,
    }
  }

  if (highestBalanceToken === 'cUSD') {
    return {
      highestBalanceToken,
      kind: 'unsupported-preferred',
      preferredSupportedToken,
    }
  }

  return {
    highestBalanceToken,
    kind: 'supported',
    preferredSupportedToken,
  }
}
