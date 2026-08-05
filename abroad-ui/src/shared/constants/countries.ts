/**
 * Shared country configurations
 * Consolidated from multiple duplicated definitions across the codebase
 */

const BRAZIL_FLAG = 'https://hatscripts.github.io/circle-flags/flags/br.svg'
const COLOMBIA_FLAG = 'https://hatscripts.github.io/circle-flags/flags/co.svg'

const COUNTRIES_DATA = {
  br: {
    currency: 'BRL',
    decimals: 2,
    flagUrl: BRAZIL_FLAG,
    location: 'Brazil',
    name: 'Brazil',
    rail: 'PIX',
    rate: 5.82,
    symbol: 'R$',
  },
  co: {
    currency: 'COP',
    decimals: 0,
    flagUrl: COLOMBIA_FLAG,
    location: 'Colombia',
    name: 'Colombia',
    rail: 'Bre-B',
    rate: 4198.5,
    symbol: '$',
  },
} as const

export const RECENT_COUNTRY_CONFIG: Record<string, { currency: string, flagUrl: string, symbol: string }>
  = Object.fromEntries(
    Object.entries(COUNTRIES_DATA).map(([, data]) => [data.currency, { currency: data.currency, flagUrl: data.flagUrl, symbol: data.symbol }]),
  )

export const CURRENCY_FLAG_URL: Record<string, string>
  = Object.fromEntries(
    Object.entries(COUNTRIES_DATA).map(([, data]) => [data.currency, data.flagUrl]),
  )

export const COUNTRIES: Record<string, { decimals: number, rate: number }>
  = Object.fromEntries(
    Object.entries(COUNTRIES_DATA).map(([, data]) => [data.currency, { decimals: data.decimals, rate: data.rate }]),
  )
